import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { AGENTS } from '@/core/domain/agents-catalog';
import type { AnalyzeScreenParams } from '@/core/application/services/agent-runner';
import type { Screenshot } from '@/core/domain/screenshot';

const PINNED_SCREENSHOT: Screenshot = {
  imageBase64: 'pinned',
  width: 10,
  height: 10,
  capturedAt: 0,
};

/** Baseline solver invocation; individual tests override fields as needed. */
function solverParams(overrides: Partial<AnalyzeScreenParams> = {}): AnalyzeScreenParams {
  return { agent: AGENTS.solver, language: 'all', instructions: '', ...overrides };
}

async function drain(iterable: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const delta of iterable) out += delta;
  return out;
}

describe('AgentRunner.analyzeScreen', () => {
  it('captures a fresh screenshot when none is provided', async () => {
    const screenCapture = new FakeScreenCaptureAdapter();
    const captureSpy = vi.spyOn(screenCapture, 'capture');
    const runner = new AgentRunner({ screenCapture, llm: new FakeLlmAdapter('ok') });

    await drain(runner.analyzeScreen(solverParams()));

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
    const runner = new AgentRunner({ screenCapture, llm: new FakeLlmAdapter('ok') });

    await drain(runner.analyzeScreen(solverParams({ screenshots: [PINNED_SCREENSHOT] })));

    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('sends the pinned screenshot bytes to the LLM, not a freshly captured one', async () => {
    const llm = new FakeLlmAdapter('ok');
    const streamSpy = vi.spyOn(llm, 'stream');
    const runner = new AgentRunner({
      screenCapture: new FakeScreenCaptureAdapter('different-bytes'),
      llm,
    });

    await drain(runner.analyzeScreen(solverParams({ screenshots: [PINNED_SCREENSHOT] })));

    const request = streamSpy.mock.calls[0]?.[0];
    const imagePart = request?.messages
      .flatMap((m) => m.parts)
      .find((p) => p.kind === 'image');
    expect(imagePart).toEqual({ kind: 'image', imageBase64: PINNED_SCREENSHOT.imageBase64 });
  });

  it('sends one image part per staged screenshot, in capture order, before the text', async () => {
    // Phase 8: the whole batch is analyzed as one unit — each shot becomes its
    // own image content part, in order, ahead of the accompanying text.
    const first: Screenshot = { imageBase64: 'first', width: 1, height: 1, capturedAt: 1 };
    const second: Screenshot = { imageBase64: 'second', width: 1, height: 1, capturedAt: 2 };
    const llm = new FakeLlmAdapter('ok');
    const streamSpy = vi.spyOn(llm, 'stream');
    const runner = new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm });

    await drain(runner.analyzeScreen(solverParams({ screenshots: [first, second] })));

    const parts = streamSpy.mock.calls[0]?.[0].messages.find((m) => m.role === 'user')?.parts ?? [];
    expect(parts.map((p) => p.kind)).toEqual(['image', 'image', 'text']);
    expect(parts[0]).toEqual({ kind: 'image', imageBase64: 'first' });
    expect(parts[1]).toEqual({ kind: 'image', imageBase64: 'second' });
  });

  it('sends the agent system prompt and mixes the language + instructions into the user text', async () => {
    const llm = new FakeLlmAdapter('ok');
    const streamSpy = vi.spyOn(llm, 'stream');
    const runner = new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm });

    await drain(
      runner.analyzeScreen(
        solverParams({ language: 'ts', instructions: 'use React', screenshots: [PINNED_SCREENSHOT] }),
      ),
    );

    const messages = streamSpy.mock.calls[0]?.[0].messages ?? [];
    const system = messages.find((m) => m.role === 'system');
    const userText = messages
      .find((m) => m.role === 'user')
      ?.parts.find((p) => p.kind === 'text');

    expect(system?.parts[0]).toMatchObject({ kind: 'text', text: AGENTS.solver.systemPrompt });
    expect(userText?.kind === 'text' && userText.text).toContain('TypeScript');
    expect(userText?.kind === 'text' && userText.text).toContain('use React');
  });

  it('sends pasted code as text and skips the fresh capture when nothing is staged (R15)', async () => {
    const screenCapture = new FakeScreenCaptureAdapter();
    const captureSpy = vi.spyOn(screenCapture, 'capture');
    const llm = new FakeLlmAdapter('ok');
    const streamSpy = vi.spyOn(llm, 'stream');
    const runner = new AgentRunner({ screenCapture, llm });

    await drain(runner.analyzeScreen(solverParams({ agent: AGENTS.reviewer, codeText: 'x := 1' })));

    expect(captureSpy).not.toHaveBeenCalled();
    const parts = streamSpy.mock.calls[0]?.[0].messages.find((m) => m.role === 'user')?.parts ?? [];
    expect(parts).toHaveLength(1);
    expect(parts[0]?.kind === 'text' && parts[0].text).toContain('<code_text>\n1| x := 1\n</code_text>');
  });

  it('keeps the staged screenshots alongside pasted code', async () => {
    const llm = new FakeLlmAdapter('ok');
    const streamSpy = vi.spyOn(llm, 'stream');
    const runner = new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm });

    await drain(
      runner.analyzeScreen(solverParams({ codeText: 'x', screenshots: [PINNED_SCREENSHOT] })),
    );

    const parts = streamSpy.mock.calls[0]?.[0].messages.find((m) => m.role === 'user')?.parts ?? [];
    expect(parts.map((p) => p.kind)).toEqual(['image', 'text']);
  });

  it("passes the agent's route (R11) and reports the finish chunk out-of-band (R19)", async () => {
    const llm = new FakeLlmAdapter('ok');
    const streamSpy = vi.spyOn(llm, 'stream');
    const onFinish = vi.fn();
    const runner = new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm });

    const text = await drain(
      runner.analyzeScreen(solverParams({ agent: AGENTS.reviewer, onFinish })),
    );

    expect(streamSpy.mock.calls[0]?.[0].route).toBe('heavy');
    expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ type: 'finish', reason: 'stop' }));
    expect(text).toBe('ok ');
  });

  it("does not choose a model — that is the resilient LLM layer's job", async () => {
    // AgentRunner no longer selects a model; it leaves `model` unset and the
    // ResilientLlm decorator fills it per attempt.
    const llm = new FakeLlmAdapter('ok');
    const streamSpy = vi.spyOn(llm, 'stream');
    const runner = new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm });

    await drain(runner.analyzeScreen(solverParams()));

    expect(streamSpy.mock.calls[0]?.[0].model).toBeUndefined();
  });
});
