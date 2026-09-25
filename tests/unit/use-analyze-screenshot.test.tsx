import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnalyzeScreenshot } from '@/ui/hooks/useAnalyzeScreenshot';
import { ServicesProvider } from '@/bootstrap/ServicesProvider';
import { createContainer } from '@/bootstrap/container';
import { useHudStore } from '@/ui/store/hud.store';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import type { LlmPort } from '@/core/application/ports/llm.port';
import type { Screenshot } from '@/core/domain/screenshot';
import type { PropsWithChildren } from 'react';

const PINNED_SCREENSHOT: Screenshot = { imageBase64: 'pinned', width: 1, height: 1, capturedAt: 0 };

function wrapperWithContainer(container: ReturnType<typeof createContainer>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <ServicesProvider container={container}>{children}</ServicesProvider>;
  };
}

beforeEach(() => {
  useHudStore.setState({
    screenshots: [],
    answer: '',
    streaming: false,
    error: null,
    instructions: '',
    activeHint: '',
    codeText: '',
  });
});

describe('useAnalyzeScreenshot', () => {
  it('fails clearly instead of silently capturing when no screenshot is pinned yet', async () => {
    // Capturing here (rather than reusing a pinned shot) would risk framing
    // the now-visible HUD itself, since nothing hides it for this path.
    const container = createContainer({
      llm: new FakeLlmAdapter('should not be reached'),
      screenCapture: new FakeScreenCaptureAdapter(),
    });
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    await act(async () => {
      await result.current();
    });

    expect(useHudStore.getState().error).toBe(
      'Нет данных для анализа — сделайте хотя бы один скриншот (хоткей захвата) или вставьте код текстом.',
    );
    expect(useHudStore.getState().answer).toBe('');
  });

  it('clears a stale transcript preview when sending without an active recording (phase 9)', async () => {
    // A transcript left over from a previous (audio) send must not linger in the
    // HUD preview implying it is attached to THIS answer — this run carries none.
    const container = createContainer({
      llm: new FakeLlmAdapter('ok'),
      screenCapture: new FakeScreenCaptureAdapter(),
    });
    useHudStore.getState().addScreenshot(PINNED_SCREENSHOT);
    useHudStore.setState({ transcript: 'stale from a prior run', recording: false });
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    await act(async () => {
      await result.current();
    });

    expect(useHudStore.getState().transcript).toBe('');
  });

  it('streams the analysis of the pinned screenshot into the store', async () => {
    const container = createContainer({
      llm: new FakeLlmAdapter('hello from fake'),
      screenCapture: new FakeScreenCaptureAdapter(),
    });
    useHudStore.getState().addScreenshot(PINNED_SCREENSHOT);
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    await act(async () => {
      await result.current();
    });

    expect(useHudStore.getState().answer.trim()).toBe('hello from fake');
    expect(useHudStore.getState().streaming).toBe(false);
    expect(useHudStore.getState().error).toBeNull();
  });

  it('clears the input hint after running and surfaces it as the active hint', async () => {
    // A hint must not silently stick to the NEXT screenshot: the input is
    // cleared after a run, while the applied hint is kept for display so the
    // user knows the answer used an extra hint (user decision 2026-07-04).
    const container = createContainer({
      llm: new FakeLlmAdapter('answer'),
      screenCapture: new FakeScreenCaptureAdapter(),
    });
    useHudStore.getState().addScreenshot(PINNED_SCREENSHOT);
    useHudStore.getState().setInstructions('  use React  ');
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    await act(async () => {
      await result.current();
    });

    expect(useHudStore.getState().instructions).toBe('');
    expect(useHudStore.getState().activeHint).toBe('use React');
  });

  it('keeps the input hint when the run fails, so a retry does not need a retype', async () => {
    // A FAILED run must not consume the hint: unlike the success path, the
    // input is left intact so the user can just hit Run again instead of
    // retyping it (L2). The applied hint is still surfaced for display.
    const failingLlm: LlmPort = {
      async *stream() {
        yield { type: 'error', message: 'provider down', retryable: false };
      },
    };
    const container = createContainer({
      llm: failingLlm,
      screenCapture: new FakeScreenCaptureAdapter(),
    });
    useHudStore.getState().addScreenshot(PINNED_SCREENSHOT);
    useHudStore.getState().setInstructions('  use React  ');
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    await act(async () => {
      await result.current();
    });

    expect(useHudStore.getState().error).toBe('provider down');
    expect(useHudStore.getState().instructions).toBe('  use React  ');
    expect(useHudStore.getState().activeHint).toBe('use React');
  });
});

describe('code text lifecycle (R15)', () => {
  it('keeps code staged DURING the run (paste-code hotkey) instead of wiping it on finish', async () => {
    // Regression (review): only the code this run sent is consumed.
    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => {
      resolveGate = r;
    });
    const llm: LlmPort = {
      async *stream() {
        await gate;
        yield { type: 'text-delta', delta: 'ok' };
        yield { type: 'finish', reason: 'stop' };
      },
    };
    const container = createContainer({ llm, screenCapture: new FakeScreenCaptureAdapter() });
    useHudStore.setState({ codeText: 'first', screenshots: [], recording: false });
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    let run!: Promise<void>;
    act(() => {
      run = result.current();
    });
    useHudStore.getState().setCodeText('second — staged mid-run');
    resolveGate();
    await act(async () => {
      await run;
    });

    expect(useHudStore.getState().codeText).toBe('second — staged mid-run');
  });

  it('consumes the code the run sent', async () => {
    const container = createContainer({ llm: new FakeLlmAdapter('ok'), screenCapture: new FakeScreenCaptureAdapter() });
    useHudStore.setState({ codeText: 'x := 1', screenshots: [], recording: false });
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    await act(async () => {
      await result.current();
    });

    expect(useHudStore.getState().codeText).toBe('');
  });
});
