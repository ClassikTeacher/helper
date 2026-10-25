import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installTrayActions, handleTrayAction } from '@/bootstrap/tray-actions';
import { toggleRecording } from '@/bootstrap/toggle-recording';
import { CaptureScreenshotUseCase } from '@/core/application/use-cases/capture-screenshot.use-case';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { TranscribeAudioUseCase } from '@/core/application/use-cases/transcribe-audio.use-case';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { FakeAudioAdapter } from '@/infrastructure/mocks/fake-audio.adapter';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { useHudStore } from '@/ui/store/hud.store';
import type { TrayAction, TrayActionHandler, TrayPort } from '@/core/application/ports/tray.port';
import type { AppContainer } from '@/bootstrap/container.types';

/** Tray fake: remembers the handler so a test can "click" a menu item. */
class FakeTrayPort implements TrayPort {
  private handler: TrayActionHandler | null = null;
  disposed = 0;

  async onAction(handler: TrayActionHandler): Promise<() => void> {
    this.handler = handler;
    return () => {
      this.disposed += 1;
      this.handler = null;
    };
  }

  click(action: TrayAction): void {
    this.handler?.(action);
  }
}

function createContainer(tray: TrayPort, audio: FakeAudioAdapter) {
  const overlay = {
    show: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    toggle: vi.fn(async () => {}),
    isVisible: async () => false,
  };
  const analyzeScreenshot = new AnalyzeScreenshotUseCase(
    new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm: new FakeLlmAdapter('fake answer') }),
  );
  const container: Pick<AppContainer, 'platform' | 'useCases'> = {
    platform: {
      overlay,
      tray,
      hotkey: { register: async () => {}, unregister: async () => {} },
      clipboard: { readText: async () => '' },
    },
    useCases: {
      analyzeScreenshot,
      captureScreenshot: new CaptureScreenshotUseCase(new FakeScreenCaptureAdapter()),
      transcribeAudio: new TranscribeAudioUseCase(audio),
    } as AppContainer['useCases'],
  };
  return { container, overlay, analyzeSpy: vi.spyOn(analyzeScreenshot, 'execute') };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useHudStore.getState().reset();
});

describe('tray actions (F1)', () => {
  it('"stop recording" from the tray stops the recorder, shows the HUD and SENDS (stop = finished question)', async () => {
    const tray = new FakeTrayPort();
    const audio = new FakeAudioAdapter('голос из трея');
    const { container, overlay, analyzeSpy } = createContainer(tray, audio);
    await installTrayActions(container);

    await toggleRecording(container.useCases); // start, as the hotkey/button would
    expect(useHudStore.getState().recording).toBe(true);
    expect(audio.recording).toBe(true);

    tray.click('stop-recording');
    await flush();
    await flush();

    expect(audio.recording).toBe(false);
    expect(useHudStore.getState().recording).toBe(false);
    expect(overlay.show).toHaveBeenCalled();
    expect(analyzeSpy).toHaveBeenCalledWith(expect.objectContaining({ transcript: 'голос из трея' }));
    expect(useHudStore.getState().answer).toContain('fake answer');
  });

  it('ignores "stop recording" when the webview is not recording (never starts one)', async () => {
    const tray = new FakeTrayPort();
    const audio = new FakeAudioAdapter('x');
    const { container, overlay, analyzeSpy } = createContainer(tray, audio);
    await installTrayActions(container);

    tray.click('stop-recording');
    await flush();

    expect(audio.recording).toBe(false);
    expect(useHudStore.getState().recording).toBe(false);
    expect(overlay.show).not.toHaveBeenCalled();
    expect(analyzeSpy).not.toHaveBeenCalled();
  });

  it('the returned disposer unsubscribes', async () => {
    const tray = new FakeTrayPort();
    const { container, overlay } = createContainer(tray, new FakeAudioAdapter(''));
    const dispose = await installTrayActions(container);
    useHudStore.setState({ recording: true });

    dispose();
    tray.click('stop-recording');
    await flush();

    expect(tray.disposed).toBe(1);
    expect(overlay.show).not.toHaveBeenCalled();
  });

  it('handleTrayAction is callable directly with the same semantics', async () => {
    const audio = new FakeAudioAdapter('');
    const { container, overlay } = createContainer(new FakeTrayPort(), audio);
    await handleTrayAction(container, 'stop-recording');
    expect(overlay.show).not.toHaveBeenCalled();
  });
});
