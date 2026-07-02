import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { ModelRouter } from '@/core/application/services/model-router';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import type { Screenshot } from '@/core/domain/screenshot';

const PINNED_SCREENSHOT: Screenshot = {
  imageBase64: 'pinned',
  width: 10,
  height: 10,
  capturedAt: 0,
};

async function drain(iterable: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const delta of iterable) out += delta;
  return out;
}

describe('AgentRunner.analyzeScreen', () => {
  it('captures a fresh screenshot when none is provided', async () => {
    const screenCapture = new FakeScreenCaptureAdapter();
    const captureSpy = vi.spyOn(screenCapture, 'capture');
    const runner = new AgentRunner({
      screenCapture,
      llm: new FakeLlmAdapter('ok'),
      modelRouter: new ModelRouter(),
    });

    await drain(runner.analyzeScreen({ prompt: 'what is this?' }));

    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('reuses a provided screenshot instead of capturing a fresh one', async () => {
    // Regression test: the hotkey flow captures once (while the HUD is
    // hidden) and pins the result to the store; analysis must reuse that
    // exact screenshot. Capturing again here would both waste a capture and
    // risk framing the now-visible HUD itself (nothing hides it a second
    // time) — see AnalyzeScreenParams.screenshot doc comment.
    const screenCapture = new FakeScreenCaptureAdapter();
    const captureSpy = vi.spyOn(screenCapture, 'capture');
    const runner = new AgentRunner({
      screenCapture,
      llm: new FakeLlmAdapter('ok'),
      modelRouter: new ModelRouter(),
    });

    await drain(runner.analyzeScreen({ prompt: 'what is this?', screenshot: PINNED_SCREENSHOT }));

    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('sends the pinned screenshot bytes to the LLM, not a freshly captured one', async () => {
    const llm = new FakeLlmAdapter('ok');
    const streamSpy = vi.spyOn(llm, 'stream');
    const runner = new AgentRunner({
      screenCapture: new FakeScreenCaptureAdapter('different-bytes'),
      llm,
      modelRouter: new ModelRouter(),
    });

    await drain(runner.analyzeScreen({ prompt: 'what is this?', screenshot: PINNED_SCREENSHOT }));

    const request = streamSpy.mock.calls[0]?.[0];
    const imagePart = request?.messages[0]?.parts.find((p) => p.kind === 'image');
    expect(imagePart).toEqual({ kind: 'image', imageBase64: PINNED_SCREENSHOT.imageBase64 });
  });
});
