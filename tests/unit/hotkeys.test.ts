import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerHotkeys,
  unregisterHotkeys,
  TOGGLE_HUD_ACCELERATOR,
  SCREENSHOT_ACCELERATOR,
} from '@/bootstrap/hotkeys';
import { CaptureScreenshotUseCase } from '@/core/application/use-cases/capture-screenshot.use-case';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { useHudStore } from '@/ui/store/hud.store';
import type { HotkeyHandler, HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { OverlayPort } from '@/core/application/ports/overlay.port';
import type { AppContainer } from '@/bootstrap/container.types';

/** Builds a real (fake-adapter-backed) AnalyzeScreenshotUseCase for the container fixture. */
function createAnalyzeScreenshot(
  llm = new FakeLlmAdapter('fake answer'),
  screenCapture = new FakeScreenCaptureAdapter(),
): AnalyzeScreenshotUseCase {
  return new AnalyzeScreenshotUseCase(new AgentRunner({ screenCapture, llm }));
}

class FakeHotkeyPort implements HotkeyPort {
  private handlers = new Map<string, HotkeyHandler>();
  readonly registered: string[] = [];
  readonly unregistered: string[] = [];

  async register(accelerator: string, handler: HotkeyHandler): Promise<void> {
    this.registered.push(accelerator);
    this.handlers.set(accelerator, handler);
  }

  async unregister(accelerator: string): Promise<void> {
    this.unregistered.push(accelerator);
    this.handlers.delete(accelerator);
  }

  press(accelerator: string): void {
    this.handlers.get(accelerator)?.();
  }
}

/**
 * Stateful fake overlay: `isVisible()` reflects prior show/hide/toggle calls, so
 * the hotkeys' native-visibility-driven logic can be exercised realistically.
 */
function createFakeOverlay(): OverlayPort & {
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  toggle: ReturnType<typeof vi.fn>;
} {
  let visible = false;
  return {
    show: vi.fn(async () => {
      visible = true;
    }),
    hide: vi.fn(async () => {
      visible = false;
    }),
    toggle: vi.fn(async () => {
      visible = !visible;
    }),
    isVisible: async () => visible,
  };
}

/** Build the container slice the hotkey wiring consumes. */
function createContainer(
  hotkey: HotkeyPort,
  overlay: OverlayPort,
  captureScreenshot = new CaptureScreenshotUseCase(new FakeScreenCaptureAdapter()),
  analyzeScreenshot = createAnalyzeScreenshot(),
): Pick<AppContainer, 'platform' | 'useCases'> {
  return {
    platform: { hotkey, overlay },
    useCases: { captureScreenshot, analyzeScreenshot } as AppContainer['useCases'],
  };
}

/** Let the fire-and-forget async hotkey handlers (+ their streamed analysis) settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useHudStore.setState({ visible: false, screenshot: null, error: null, answer: '', streaming: false });
});

describe('registerHotkeys', () => {
  it('registers both the toggle and screenshot accelerators', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await registerHotkeys(createContainer(hotkey, overlay));

    expect(hotkey.registered).toEqual([TOGGLE_HUD_ACCELERATOR, SCREENSHOT_ACCELERATOR]);
  });

  it('toggle hotkey flips overlay visibility and never captures', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const capture = new CaptureScreenshotUseCase(new FakeScreenCaptureAdapter());
    const spy = vi.spyOn(capture, 'execute');

    await registerHotkeys(createContainer(hotkey, overlay, capture));
    hotkey.press(TOGGLE_HUD_ACCELERATOR);
    await flush();

    expect(overlay.toggle).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    expect(useHudStore.getState().screenshot).toBeNull();
  });

  it('screenshot hotkey captures, shows the HUD, and streams an automatic analysis (main scenario)', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await registerHotkeys(createContainer(hotkey, overlay));
    hotkey.press(SCREENSHOT_ACCELERATOR);
    await flush();

    expect(overlay.hide).not.toHaveBeenCalled();
    expect(overlay.show).toHaveBeenCalledTimes(1);
    expect(useHudStore.getState().screenshot).not.toBeNull();
    // plan.md main scenario: hotkey -> screenshot -> analyze -> stream, with
    // no manual "Ask" step required.
    expect(useHudStore.getState().answer).toContain('fake answer');
    expect(useHudStore.getState().streaming).toBe(false);
    expect(useHudStore.getState().error).toBeNull();
  });

  it('reuses the just-captured screenshot for analysis instead of capturing a second time', async () => {
    // Regression test: a second capture here would waste a call and re-grab the
    // screen for no reason — see AgentRunner's AnalyzeScreenParams.screenshot
    // doc comment. (The now-visible HUD would not appear in a second shot either
    // way: it is content-protected, WDA_EXCLUDEFROMCAPTURE.)
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const analysisScreenCapture = new FakeScreenCaptureAdapter();
    const analysisCaptureSpy = vi.spyOn(analysisScreenCapture, 'capture');
    const analyzeScreenshot = createAnalyzeScreenshot(new FakeLlmAdapter('fake answer'), analysisScreenCapture);

    await registerHotkeys(createContainer(hotkey, overlay, undefined, analyzeScreenshot));
    hotkey.press(SCREENSHOT_ACCELERATOR);
    await flush();

    expect(analysisCaptureSpy).not.toHaveBeenCalled();
    expect(useHudStore.getState().answer).toContain('fake answer');
  });

  it('never hides the HUD before capturing — content protection keeps it out of the shot', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await registerHotkeys(createContainer(hotkey, overlay));
    await overlay.show(); // HUD already visible
    hotkey.press(SCREENSHOT_ACCELERATOR);
    await flush();

    // The overlay window is content-protected (WDA_EXCLUDEFROMCAPTURE on
    // Windows), so DWM composites it out of the capture frame without hiding
    // it — the old hide-before / show-after dance is gone (no flicker).
    expect(overlay.hide).not.toHaveBeenCalled();
    // Shown once by the test setup + once by the handler after capturing.
    expect(overlay.show).toHaveBeenCalledTimes(2);
    expect(useHudStore.getState().screenshot).not.toBeNull();
  });

  it('surfaces a capture failure in the HUD instead of swallowing it, without attempting analysis', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const failing = {
      execute: vi.fn(async () => {
        throw new Error('capture device unavailable');
      }),
    } as unknown as CaptureScreenshotUseCase;
    const analyzeScreenshot = createAnalyzeScreenshot();
    const analyzeSpy = vi.spyOn(analyzeScreenshot, 'execute');

    await registerHotkeys(createContainer(hotkey, overlay, failing, analyzeScreenshot));
    hotkey.press(SCREENSHOT_ACCELERATOR);
    await flush();

    expect(useHudStore.getState().error).toBe('capture device unavailable');
    // The HUD is still shown so the user sees the error.
    expect(overlay.show).toHaveBeenCalledTimes(1);
    // Nothing to analyze — and calling it would have overwritten the capture
    // error with analyzeAndStream's own startStreaming() reset.
    expect(analyzeSpy).not.toHaveBeenCalled();
  });

  it('propagates registration failures instead of swallowing them', async () => {
    const hotkey: HotkeyPort = {
      register: vi.fn(async () => {
        throw new Error('shortcut already registered by another application');
      }),
      unregister: vi.fn(async () => {}),
    };
    const overlay = createFakeOverlay();

    await expect(registerHotkeys(createContainer(hotkey, overlay))).rejects.toThrow(
      'shortcut already registered by another application',
    );
  });

  it('registers the second hotkey even if the first one conflicts', async () => {
    const overlay = createFakeOverlay();
    const hotkey: HotkeyPort = {
      register: vi.fn(async (accelerator: string) => {
        if (accelerator === TOGGLE_HUD_ACCELERATOR) {
          throw new Error('toggle accelerator taken');
        }
      }),
      unregister: vi.fn(async () => {}),
    };

    // Registration still rejects (to surface the conflict) …
    await expect(registerHotkeys(createContainer(hotkey, overlay))).rejects.toThrow(
      'toggle accelerator taken',
    );
    // … but the screenshot accelerator was still attempted/registered.
    expect(hotkey.register).toHaveBeenCalledWith(SCREENSHOT_ACCELERATOR, expect.any(Function));
  });
});

describe('unregisterHotkeys', () => {
  it('unregisters both accelerators', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await unregisterHotkeys({ platform: { hotkey, overlay } });

    expect(hotkey.unregistered).toEqual([TOGGLE_HUD_ACCELERATOR, SCREENSHOT_ACCELERATOR]);
  });
});
