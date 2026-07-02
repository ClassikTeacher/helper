import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnalyzeScreenshot } from '@/ui/hooks/useAnalyzeScreenshot';
import { ServicesProvider } from '@/bootstrap/ServicesProvider';
import { createContainer } from '@/bootstrap/container';
import { useHudStore } from '@/ui/store/hud.store';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import type { Screenshot } from '@/core/domain/screenshot';
import type { PropsWithChildren } from 'react';

const PINNED_SCREENSHOT: Screenshot = { imageBase64: 'pinned', width: 1, height: 1, capturedAt: 0 };

function wrapperWithContainer(container: ReturnType<typeof createContainer>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <ServicesProvider container={container}>{children}</ServicesProvider>;
  };
}

beforeEach(() => {
  useHudStore.setState({ screenshot: null, answer: '', streaming: false, error: null });
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
      await result.current('what is this?');
    });

    expect(useHudStore.getState().error).toBe('No screenshot yet — press the screenshot hotkey first.');
    expect(useHudStore.getState().answer).toBe('');
  });

  it('streams the analysis of the pinned screenshot into the store', async () => {
    const container = createContainer({
      llm: new FakeLlmAdapter('hello from fake'),
      screenCapture: new FakeScreenCaptureAdapter(),
    });
    useHudStore.getState().setScreenshot(PINNED_SCREENSHOT);
    const { result } = renderHook(() => useAnalyzeScreenshot(), { wrapper: wrapperWithContainer(container) });

    await act(async () => {
      await result.current('what is this?');
    });

    expect(useHudStore.getState().answer.trim()).toBe('hello from fake');
    expect(useHudStore.getState().streaming).toBe(false);
    expect(useHudStore.getState().error).toBeNull();
  });
});
