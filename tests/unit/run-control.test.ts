import { describe, it, expect, beforeEach, vi } from 'vitest';
import { abortReason, beginRun, endRun, stopRun } from '@/bootstrap/run-control';
import { analyzeAndStream } from '@/bootstrap/analyze-and-stream';
import { runSend } from '@/bootstrap/send-batch';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { AGENTS } from '@/core/domain/agents-catalog';
import { useHudStore } from '@/ui/store/hud.store';
import type { LlmChunk, LlmPort } from '@/core/application/ports/llm.port';
import type { AppContainer } from '@/bootstrap/container.types';

/** An LLM whose deltas are released one by one by the test. */
function gatedLlm(): LlmPort & { release: (delta: string) => void; finish: () => void } {
  const queue: ((chunk: LlmChunk | null) => void)[] = [];
  const pending: (LlmChunk | null)[] = [];
  const push = (chunk: LlmChunk | null) => {
    const waiter = queue.shift();
    if (waiter) waiter(chunk);
    else pending.push(chunk);
  };
  return {
    release: (delta) => push({ type: 'text-delta', delta }),
    finish: () => push({ type: 'finish', reason: 'stop' }),
    async *stream(request) {
      while (true) {
        const next =
          pending.length > 0 ? pending.shift()! : await new Promise<LlmChunk | null>((r) => queue.push(r));
        if (request.signal?.aborted) return;
        if (!next) return;
        yield next;
        if (next.type === 'finish') return;
      }
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function useCasesWith(llm: LlmPort): Pick<AppContainer['useCases'], 'analyzeScreenshot'> {
  return {
    analyzeScreenshot: new AnalyzeScreenshotUseCase(
      new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm }),
    ),
  };
}

const PARAMS = {
  agent: AGENTS.solver,
  language: 'all' as const,
  instructions: 'hint',
  screenshots: [{ imageBase64: 'x', width: 1, height: 1, capturedAt: 0 }],
};

beforeEach(() => {
  stopRun();
  useHudStore.getState().reset();
  useHudStore.setState({ instructions: '', stopped: false });
});

describe('run-control', () => {
  it('a new run supersedes the previous one', () => {
    const first = beginRun();
    const second = beginRun();
    expect(abortReason(first)).toBe('superseded');
    expect(second.aborted).toBe(false);
    endRun(second);
    expect(stopRun()).toBe(false);
  });

  it('stopRun aborts the active run with reason "stop"', () => {
    const signal = beginRun();
    expect(stopRun()).toBe(true);
    expect(abortReason(signal)).toBe('stop');
  });

  it('endRun of an older run does not clear the newer one', () => {
    const first = beginRun();
    const second = beginRun();
    endRun(first);
    expect(stopRun()).toBe(true);
    expect(abortReason(second)).toBe('stop');
  });
});

describe('analyzeAndStream: one active run (P0)', () => {
  it('a second send supersedes the first — answers never interleave', async () => {
    const firstLlm = gatedLlm();
    const secondLlm = gatedLlm();
    const first = analyzeAndStream(useCasesWith(firstLlm), PARAMS);
    await tick();
    firstLlm.release('OLD-1 ');
    await tick();
    expect(useHudStore.getState().answer).toBe('OLD-1 ');

    const second = analyzeAndStream(useCasesWith(secondLlm), PARAMS);
    await tick();
    firstLlm.release('OLD-2 '); // arrives after it was superseded
    secondLlm.release('NEW ');
    secondLlm.finish();
    await Promise.all([first, second]);

    expect(useHudStore.getState().answer).toBe('NEW ');
    expect(useHudStore.getState().streaming).toBe(false);
    expect(useHudStore.getState().stopped).toBe(false);
  });

  it('Stop keeps the partial answer, marks it stopped, and keeps the inputs for a re-run', async () => {
    const llm = gatedLlm();
    const record = vi.fn(async () => {});
    useHudStore.setState({ instructions: 'hint', codeText: 'code' });
    const run = analyzeAndStream(
      { ...useCasesWith(llm), recordConversation: { execute: record } as never },
      { ...PARAMS, codeText: 'code' },
    );
    await tick();
    llm.release('part ');
    await tick();

    stopRun();
    llm.release('ignored');
    await run;

    const state = useHudStore.getState();
    expect(state.answer).toBe('part ');
    expect(state.streaming).toBe(false);
    expect(state.stopped).toBe(true);
    expect(state.instructions).toBe('hint');
    expect(state.codeText).toBe('code');
    expect(record).not.toHaveBeenCalled();
  });

  it('a send is ignored while the previous send is still transcribing', async () => {
    const llm = gatedLlm();
    const spy = vi.spyOn(llm, 'stream');
    useHudStore.setState({ transcribing: true, codeText: 'x' });

    await runSend(useCasesWith(llm) as AppContainer['useCases']);

    expect(spy).not.toHaveBeenCalled();
  });
});
