import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  });
});

describe('useAnalyzeScreenshot', () => {
  it('fails clearly instead of silently capturing when there is neither a screenshot nor input text', async () => {
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
      'Нечего анализировать — сделайте скриншот (хоткей захвата) или введите текст задачи в поле ввода.',
    );
    expect(useHudStore.getState().answer).toBe('');
  });

  it('runs on input text alone — a screenshot is not required when code is pasted in', async () => {
    // The Run button must work for a paste-only send (the reviewer's main
    // text path); demanding a screenshot on top of pasted code blocked it.
    const screenCapture = new FakeScreenCaptureAdapter();
    const captureSpy = vi.spyOn(screenCapture, 'capture');
    const container = createContainer({ llm: new FakeLlmAdapter('review result'), screenCapture });
    useHudStore.getState().setInstructions('func Handle() error { return nil }');
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    await act(async () => {
      await result.current();
    });

    expect(useHudStore.getState().error).toBeNull();
    expect(useHudStore.getState().answer).toContain('review result');
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('ignores whitespace-only input — blanks are not a task', async () => {
    const container = createContainer({
      llm: new FakeLlmAdapter('should not be reached'),
      screenCapture: new FakeScreenCaptureAdapter(),
    });
    useHudStore.getState().setInstructions('   \n  ');
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    await act(async () => {
      await result.current();
    });

    expect(useHudStore.getState().error).toContain('Нечего анализировать');
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
