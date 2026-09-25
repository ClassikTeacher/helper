import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerHotkeys,
  unregisterHotkeys,
  TOGGLE_HUD_ACCELERATOR,
  CAPTURE_ACCELERATOR,
  SEND_ACCELERATOR,
  RECORD_ACCELERATOR,
  PASTE_CODE_ACCELERATOR,
} from '@/bootstrap/hotkeys';
import { CaptureScreenshotUseCase } from '@/core/application/use-cases/capture-screenshot.use-case';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { TranscribeAudioUseCase } from '@/core/application/use-cases/transcribe-audio.use-case';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { FakeAudioAdapter } from '@/infrastructure/mocks/fake-audio.adapter';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { useHudStore, MAX_SCREENSHOTS } from '@/ui/store/hud.store';
import type { HotkeyHandler, HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { OverlayPort } from '@/core/application/ports/overlay.port';
import type { AudioTranscriptionPort } from '@/core/application/ports/audio-transcription.port';
import type { ClipboardPort } from '@/core/application/ports/clipboard.port';
import type { AppContainer } from '@/bootstrap/container.types';

/** Clipboard fake whose text a test can set. */
function createFakeClipboard(text = ''): ClipboardPort & { text: string } {
  const clipboard = {
    text,
    readText: async () => clipboard.text,
  };
  return clipboard;
}

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
  transcribeAudio = new TranscribeAudioUseCase(new FakeAudioAdapter()),
  clipboard: ClipboardPort = createFakeClipboard(),
): Pick<AppContainer, 'platform' | 'useCases'> {
  return {
    platform: { hotkey, overlay, clipboard },
    useCases: { captureScreenshot, analyzeScreenshot, transcribeAudio } as AppContainer['useCases'],
  };
}

/** Let the fire-and-forget async hotkey handlers (+ their streamed analysis) settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useHudStore.setState({
    visible: false,
    screenshots: [],
    error: null,
    answer: '',
    streaming: false,
    recording: false,
    transcribing: false,
    transcript: '',
    codeText: '',
    lastRun: null,
  });
});

describe('registerHotkeys', () => {
  it('registers the toggle, capture, send, record, and paste-code accelerators', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await registerHotkeys(createContainer(hotkey, overlay));

    expect(hotkey.registered).toEqual([
      TOGGLE_HUD_ACCELERATOR,
      CAPTURE_ACCELERATOR,
      SEND_ACCELERATOR,
      RECORD_ACCELERATOR,
      PASTE_CODE_ACCELERATOR,
    ]);
  });

  it('paste-code hotkey stages the clipboard text as code and shows the HUD (R15)', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const clipboard = createFakeClipboard('func main() {}\n');
    await registerHotkeys(
      createContainer(hotkey, overlay, undefined, undefined, undefined, clipboard),
    );

    hotkey.press(PASTE_CODE_ACCELERATOR);
    await flush();

    expect(useHudStore.getState().codeText).toBe('func main() {}\n');
    expect(overlay.show).toHaveBeenCalled();
  });

  it('paste-code hotkey with an empty clipboard reports it instead of staging nothing', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    await registerHotkeys(
      createContainer(hotkey, overlay, undefined, undefined, undefined, createFakeClipboard('  ')),
    );

    hotkey.press(PASTE_CODE_ACCELERATOR);
    await flush();

    expect(useHudStore.getState().codeText).toBe('');
    expect(useHudStore.getState().error).toContain('Буфер обмена не содержит текста');
  });

  it('paste-code with an empty clipboard does not stop a recording in progress', async () => {
    // Regression (review): the feedback must not go through `fail`, which
    // would flip `recording` off while the native recorder keeps running.
    const hotkey = new FakeHotkeyPort();
    await registerHotkeys(
      createContainer(hotkey, createFakeOverlay(), undefined, undefined, undefined, createFakeClipboard('')),
    );
    useHudStore.setState({ recording: true, streaming: true });

    hotkey.press(PASTE_CODE_ACCELERATOR);
    await flush();

    expect(useHudStore.getState().recording).toBe(true);
    expect(useHudStore.getState().streaming).toBe(true);
    expect(useHudStore.getState().error).toContain('Буфер обмена');
  });

  it('send with staged code and no screenshots runs a text-only request and consumes the code', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const screenCapture = new FakeScreenCaptureAdapter();
    const captureSpy = vi.spyOn(screenCapture, 'capture');
    const llm = new FakeLlmAdapter('text answer');
    const streamSpy = vi.spyOn(llm, 'stream');
    await registerHotkeys(
      createContainer(hotkey, overlay, undefined, createAnalyzeScreenshot(llm, screenCapture)),
    );
    useHudStore.setState({ codeText: 'x := 1' });

    hotkey.press(SEND_ACCELERATOR);
    await flush();
    await flush();

    expect(captureSpy).not.toHaveBeenCalled();
    const parts = streamSpy.mock.calls[0]?.[0].messages.find((m) => m.role === 'user')?.parts ?? [];
    expect(parts.map((p) => p.kind)).toEqual(['text']);
    expect(useHudStore.getState().answer.trim()).toBe('text answer');
    expect(useHudStore.getState().codeText).toBe('');
    // R9/R19: the finish chunk reaches the HUD.
    expect(useHudStore.getState().lastRun).toMatchObject({ reason: 'stop', fallback: false });
  });

  it('record hotkey starts recording, then a second press stops and SENDS (stop = finished question)', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const audio = new FakeAudioAdapter('привет из аудио');
    const transcribeAudio = new TranscribeAudioUseCase(audio);
    const analyzeScreenshot = createAnalyzeScreenshot();
    const analyzeSpy = vi.spyOn(analyzeScreenshot, 'execute');

    await registerHotkeys(
      createContainer(hotkey, overlay, undefined, analyzeScreenshot, transcribeAudio),
    );

    // Stage a shot, then start recording — no analysis yet.
    hotkey.press(CAPTURE_ACCELERATOR);
    await flush();
    hotkey.press(RECORD_ACCELERATOR);
    await flush();
    expect(useHudStore.getState().recording).toBe(true);
    expect(audio.recording).toBe(true);
    expect(analyzeSpy).not.toHaveBeenCalled();

    // Second press = stop = send: the recorder is stopped, the audio transcribed
    // and attached, the answer streamed, and the recording flag cleared.
    hotkey.press(RECORD_ACCELERATOR);
    await flush();
    expect(audio.recording).toBe(false);
    expect(useHudStore.getState().recording).toBe(false);
    expect(analyzeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: 'привет из аудио' }),
    );
    expect(useHudStore.getState().answer).toContain('fake answer');
  });

  it('stop = send works with no staged screenshots (audio-only, fresh-capture fallback)', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const transcribeAudio = new TranscribeAudioUseCase(new FakeAudioAdapter('только голос'));
    const analyzeScreenshot = createAnalyzeScreenshot();
    const analyzeSpy = vi.spyOn(analyzeScreenshot, 'execute');

    await registerHotkeys(
      createContainer(hotkey, overlay, undefined, analyzeScreenshot, transcribeAudio),
    );

    hotkey.press(RECORD_ACCELERATOR); // start (nothing staged)
    await flush();
    hotkey.press(RECORD_ACCELERATOR); // stop = send
    await flush();

    // No "Нет скриншотов" error: while recording, an empty batch is allowed and
    // the runner falls back to a single fresh capture.
    expect(analyzeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: 'только голос' }),
    );
    expect(useHudStore.getState().error).toBeNull();
    expect(useHudStore.getState().answer).toContain('fake answer');
  });

  it('send hotkey attaches the transcript when recording is active', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const analyzeScreenshot = createAnalyzeScreenshot();
    const analyzeSpy = vi.spyOn(analyzeScreenshot, 'execute');
    const transcribeAudio = new TranscribeAudioUseCase(new FakeAudioAdapter('привет из аудио'));

    await registerHotkeys(
      createContainer(hotkey, overlay, undefined, analyzeScreenshot, transcribeAudio),
    );
    hotkey.press(CAPTURE_ACCELERATOR);
    await flush();
    hotkey.press(RECORD_ACCELERATOR);
    await flush();
    hotkey.press(SEND_ACCELERATOR);
    await flush();

    // The transcript rides along in the analyze params, and recording is cleared.
    expect(analyzeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: 'привет из аудио' }),
    );
    expect(useHudStore.getState().transcript).toBe('привет из аудио');
    expect(useHudStore.getState().recording).toBe(false);
  });

  it('surfaces an STT failure on send and does not analyze', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const analyzeScreenshot = createAnalyzeScreenshot();
    const analyzeSpy = vi.spyOn(analyzeScreenshot, 'execute');
    // A transcribe that rejects — the audio context is lost, and the user must
    // be told rather than have it silently swallowed.
    const failingAudio: AudioTranscriptionPort = {
      startRecording: async () => {},
      stopRecording: async () => {},
      transcribe: async () => {
        throw new Error('stt provider down');
      },
    };
    const transcribeAudio = new TranscribeAudioUseCase(failingAudio);

    await registerHotkeys(
      createContainer(hotkey, overlay, undefined, analyzeScreenshot, transcribeAudio),
    );
    hotkey.press(CAPTURE_ACCELERATOR);
    await flush();
    hotkey.press(RECORD_ACCELERATOR);
    await flush();
    hotkey.press(SEND_ACCELERATOR);
    await flush();

    expect(useHudStore.getState().error).toBe('stt provider down');
    expect(useHudStore.getState().transcribing).toBe(false);
    expect(analyzeSpy).not.toHaveBeenCalled();
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
    expect(useHudStore.getState().screenshots).toEqual([]);
  });

  it('capture hotkey stages a screenshot and shows the HUD WITHOUT analyzing (phase 8)', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const analyzeScreenshot = createAnalyzeScreenshot();
    const analyzeSpy = vi.spyOn(analyzeScreenshot, 'execute');

    await registerHotkeys(createContainer(hotkey, overlay, undefined, analyzeScreenshot));
    hotkey.press(CAPTURE_ACCELERATOR);
    await flush();

    expect(overlay.hide).not.toHaveBeenCalled();
    expect(overlay.show).toHaveBeenCalledTimes(1);
    expect(useHudStore.getState().screenshots).toHaveLength(1);
    // Decoupled from analysis: capture only stages the shot.
    expect(analyzeSpy).not.toHaveBeenCalled();
    expect(useHudStore.getState().answer).toBe('');
    expect(useHudStore.getState().streaming).toBe(false);
  });

  it('capture hotkey accumulates multiple screenshots up to the cap', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await registerHotkeys(createContainer(hotkey, overlay));
    // Press one more than the cap; the store ignores the overflow.
    for (let i = 0; i < MAX_SCREENSHOTS + 1; i++) {
      hotkey.press(CAPTURE_ACCELERATOR);
      await flush();
    }

    expect(useHudStore.getState().screenshots).toHaveLength(MAX_SCREENSHOTS);
  });

  it('send hotkey analyzes the staged batch and streams the answer (main scenario)', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await registerHotkeys(createContainer(hotkey, overlay));
    hotkey.press(CAPTURE_ACCELERATOR);
    await flush();
    hotkey.press(SEND_ACCELERATOR);
    await flush();

    // plan.md main scenario: staged screenshots -> analyze -> stream.
    expect(useHudStore.getState().answer).toContain('fake answer');
    expect(useHudStore.getState().streaming).toBe(false);
    expect(useHudStore.getState().error).toBeNull();
  });

  it('send hotkey reuses the staged batch instead of capturing again', async () => {
    // Regression test: analysis must reuse the staged shots, not re-grab the
    // screen — the content-protected HUD is out of the shot either way, but a
    // second capture would be wasted work.
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const analysisScreenCapture = new FakeScreenCaptureAdapter();
    const analysisCaptureSpy = vi.spyOn(analysisScreenCapture, 'capture');
    const analyzeScreenshot = createAnalyzeScreenshot(
      new FakeLlmAdapter('fake answer'),
      analysisScreenCapture,
    );

    await registerHotkeys(createContainer(hotkey, overlay, undefined, analyzeScreenshot));
    hotkey.press(CAPTURE_ACCELERATOR);
    await flush();
    hotkey.press(SEND_ACCELERATOR);
    await flush();

    expect(analysisCaptureSpy).not.toHaveBeenCalled();
    expect(useHudStore.getState().answer).toContain('fake answer');
  });

  it('send hotkey with an empty batch surfaces a clear error and does not analyze', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const analyzeScreenshot = createAnalyzeScreenshot();
    const analyzeSpy = vi.spyOn(analyzeScreenshot, 'execute');

    await registerHotkeys(createContainer(hotkey, overlay, undefined, analyzeScreenshot));
    hotkey.press(SEND_ACCELERATOR);
    await flush();

    expect(useHudStore.getState().error).toContain('Нет данных для анализа');
    expect(analyzeSpy).not.toHaveBeenCalled();
    // The HUD is shown so the user sees the error.
    expect(overlay.show).toHaveBeenCalled();
  });

  it('never hides the HUD before capturing — content protection keeps it out of the shot', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await registerHotkeys(createContainer(hotkey, overlay));
    await overlay.show(); // HUD already visible
    hotkey.press(CAPTURE_ACCELERATOR);
    await flush();

    // The overlay window is content-protected (WDA_EXCLUDEFROMCAPTURE on
    // Windows), so DWM composites it out of the capture frame without hiding
    // it — the old hide-before / show-after dance is gone (no flicker).
    expect(overlay.hide).not.toHaveBeenCalled();
    expect(useHudStore.getState().screenshots).toHaveLength(1);
  });

  it('surfaces a capture failure in the HUD instead of swallowing it, and stages nothing', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();
    const failing = {
      execute: vi.fn(async () => {
        throw new Error('capture device unavailable');
      }),
    } as unknown as CaptureScreenshotUseCase;

    await registerHotkeys(createContainer(hotkey, overlay, failing));
    hotkey.press(CAPTURE_ACCELERATOR);
    await flush();

    expect(useHudStore.getState().error).toBe('capture device unavailable');
    expect(useHudStore.getState().screenshots).toEqual([]);
    // The HUD is still shown so the user sees the error.
    expect(overlay.show).toHaveBeenCalledTimes(1);
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

  it('registers the other hotkeys even if the first one conflicts', async () => {
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
    // … but the capture + send accelerators were still attempted/registered.
    expect(hotkey.register).toHaveBeenCalledWith(CAPTURE_ACCELERATOR, expect.any(Function));
    expect(hotkey.register).toHaveBeenCalledWith(SEND_ACCELERATOR, expect.any(Function));
  });
});

describe('unregisterHotkeys', () => {
  it('unregisters all five accelerators', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await unregisterHotkeys({ platform: { hotkey, overlay, clipboard: createFakeClipboard() } });

    expect(hotkey.unregistered).toEqual([
      TOGGLE_HUD_ACCELERATOR,
      CAPTURE_ACCELERATOR,
      SEND_ACCELERATOR,
      RECORD_ACCELERATOR,
      PASTE_CODE_ACCELERATOR,
    ]);
  });
});
