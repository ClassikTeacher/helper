import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentRunner } from '@/core/application/services/agent-runner';
import {
  compactHistory,
  historyMessages,
  HISTORY_LIMITS,
  type ConversationTurn,
} from '@/core/application/services/conversation-history';
import { CONTINUATION_NOTE, buildAgentPrompt } from '@/core/application/services/agent-prompt';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { analyzeAndStream } from '@/bootstrap/analyze-and-stream';
import { runSend } from '@/bootstrap/send-batch';
import { stopRun } from '@/bootstrap/run-control';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { AGENTS } from '@/core/domain/agents-catalog';
import { useHudStore } from '@/ui/store/hud.store';
import { DialogBar } from '@/ui/components/DialogBar';
import { PromptInput } from '@/ui/components/PromptInput';
import type { LlmChunk, LlmMessage, LlmPort, LlmStreamRequest } from '@/core/application/ports/llm.port';
import type { AppContainer } from '@/bootstrap/container.types';

/** Records requests; answers each call with the next scripted reply. */
function scriptedLlm(...replies: string[]): LlmPort & { requests: LlmStreamRequest[] } {
  const requests: LlmStreamRequest[] = [];
  return {
    requests,
    async *stream(request): AsyncIterable<LlmChunk> {
      requests.push(request);
      const reply = replies[requests.length - 1] ?? 'ok';
      yield { type: 'text-delta', delta: reply };
      yield { type: 'finish', reason: 'stop' };
    },
  };
}

const failingLlm: LlmPort = {
  async *stream() {
    yield { type: 'error', message: 'boom', retryable: false };
  },
};

const SHOT = { imageBase64: 'img', width: 1, height: 1, capturedAt: 0 };

async function drain(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const d of it) out += d;
  return out;
}

const textOf = (message: LlmMessage | undefined) =>
  message?.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('') ?? '';
const imagesIn = (req: LlmStreamRequest) =>
  req.messages.flatMap((m) => m.parts).filter((p) => p.kind === 'image').length;
const roles = (req: LlmStreamRequest) => req.messages.map((m) => m.role);

function useCasesWith(llm: LlmPort, extra: Partial<AppContainer['useCases']> = {}): AppContainer['useCases'] {
  return {
    analyzeScreenshot: new AnalyzeScreenshotUseCase(
      new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm }),
    ),
    ...extra,
  } as AppContainer['useCases'];
}

const turn = (n: number, extra: Partial<ConversationTurn> = {}): ConversationTurn => ({
  userText: `q${n}`,
  answer: `a${n}`,
  ...extra,
});

describe('compactHistory', () => {
  it('keeps a short dialog as is', () => {
    const turns = [turn(1), turn(2)];
    expect(compactHistory(turns)).toEqual(turns);
  });

  it('drops the oldest turns past maxTurns, down to trimToTurns (no special first turn)', () => {
    const turns = Array.from({ length: HISTORY_LIMITS.maxTurns + 1 }, (_, i) => turn(i));
    const kept = compactHistory(turns);
    expect(kept).toHaveLength(HISTORY_LIMITS.trimToTurns);
    expect(kept.at(-1)!.answer).toBe(`a${HISTORY_LIMITS.maxTurns}`);
    expect(kept[0]!.answer).toBe(`a${HISTORY_LIMITS.maxTurns + 1 - HISTORY_LIMITS.trimToTurns}`);
  });

  it('trims rarely: at maxTurns nothing is dropped yet (stable prefix for the prompt cache)', () => {
    const turns = Array.from({ length: HISTORY_LIMITS.maxTurns }, (_, i) => turn(i));
    expect(compactHistory(turns)).toHaveLength(HISTORY_LIMITS.maxTurns);
  });

  it('drops the oldest turns past maxChars, but always keeps the newest one', () => {
    const limits = { ...HISTORY_LIMITS, maxChars: 100, trimToChars: 60 };
    const long = (n: number) => turn(n, { answer: 'x'.repeat(40) });
    expect(compactHistory([long(1), long(2), long(3)], limits).map((t) => t.userText)).toEqual(['q3']);
    const huge = turn(9, { answer: 'x'.repeat(500) });
    expect(compactHistory([huge], limits)).toEqual([huge]);
  });

  it('replays screenshots newest-first within the image budget; older turns lose theirs', () => {
    const imgs = (n: number) => Array.from({ length: n }, (_, i) => `img${i}`);
    const kept = compactHistory([turn(1, { images: imgs(2) }), turn(2), turn(3, { images: imgs(4) })]);
    expect(kept[2]!.images).toHaveLength(4);
    expect(kept[0]!.images).toBeUndefined();
    expect(kept[0]!.omittedImages).toBe(2);
    expect(kept[0]!.answer).toBe('a1');
  });
});

describe('historyMessages', () => {
  it('turns the dialog into user/assistant pairs and notes omitted screenshots', () => {
    const messages = historyMessages([turn(1, { images: ['i'] }), turn(2, { omittedImages: 3 })]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[0]!.parts.map((p) => p.kind)).toEqual(['image', 'text']);
    expect(textOf(messages[2])).toContain('3 screenshot(s) of this message are omitted');
    expect(textOf(messages[2])).toContain('q2');
    // Deterministic: the same turns give the same messages (cacheable prefix).
    expect(historyMessages([turn(1)])).toEqual(historyMessages([turn(1)]));
  });
});

describe('AgentRunner with dialog history', () => {
  it('replays the history before the new batch and marks the new message as the cache breakpoint', async () => {
    const llm = scriptedLlm('answer');
    const runner = new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm });

    await drain(
      runner.analyzeScreen({
        agent: AGENTS.reviewer,
        language: 'all',
        instructions: '',
        screenshots: [SHOT],
        history: [turn(1)],
      }),
    );

    const req = llm.requests[0]!;
    expect(roles(req)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(req.messages.map((m) => m.cache ?? false)).toEqual([false, false, false, true]);
    expect(textOf(req.messages[3])).toContain(CONTINUATION_NOTE);
  });

  it('a first message carries no continuation note — its prompt is the one the eval measures', async () => {
    const llm = scriptedLlm('answer');
    const runner = new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm });
    await drain(runner.analyzeScreen({ agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] }));

    const sent = textOf(llm.requests[0]!.messages[1]);
    expect(sent).not.toContain(CONTINUATION_NOTE);
    expect(sent).toBe(buildAgentPrompt({ agent: AGENTS.solver, language: 'all', instructions: '' }).userText);
  });

  it('ask: a typed question goes last, text only, with the solver language hint', async () => {
    const llm = scriptedLlm('answer');
    const runner = new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm });
    await drain(
      runner.ask({ agent: AGENTS.solver, language: 'go', history: [turn(1)], question: 'а без доп. памяти?' }),
    );

    const req = llm.requests[0]!;
    expect(req.route).toBe('light');
    expect(roles(req)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(imagesIn(req)).toBe(0);
    const last = textOf(req.messages[3]);
    expect(last).toContain('<question>\nа без доп. памяти?\n</question>');
    expect(last).toContain(CONTINUATION_NOTE);
    expect(last).toContain('Go');
    expect(req.messages[3]!.cache).toBe(true);
  });
});

describe('dialogs in the HUD flow', () => {
  beforeEach(() => {
    stopRun();
    useHudStore.getState().reset();
    useHudStore.setState({ instructions: '', agentId: 'solver' });
  });

  it('every message continues the dialog of its mode', async () => {
    const llm = scriptedLlm('answer 1', 'answer 2', 'answer 3');
    const useCases = useCasesWith(llm);

    useHudStore.setState({ screenshots: [SHOT] });
    await runSend(useCases);
    useHudStore.setState({ screenshots: [SHOT] });
    await runSend(useCases); // a second batch: continues, not a new dialog
    useHudStore.setState({ screenshots: [], instructions: 'а за O(1) памяти?' });
    await runSend(useCases); // typed text only: a question in the same dialog

    expect(roles(llm.requests[1]!)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(roles(llm.requests[2]!)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'user']);
    const state = useHudStore.getState();
    expect(state.dialogs.solver?.turns.map((t) => t.answer)).toEqual(['answer 1', 'answer 2', 'answer 3']);
    expect(state.answer).toBe('answer 3');
    expect(state.instructions).toBe('');
    expect(state.activeHint).toBe('↳ а за O(1) памяти?');
  });

  it('a typed question also works as the FIRST message of a dialog', async () => {
    const llm = scriptedLlm('answer');
    useHudStore.setState({ instructions: 'что такое замыкание?' });
    await runSend(useCasesWith(llm));

    expect(roles(llm.requests[0]!)).toEqual(['system', 'user']);
    expect(textOf(llm.requests[0]!.messages[1])).not.toContain(CONTINUATION_NOTE);
    expect(useHudStore.getState().dialogs.solver?.turns).toHaveLength(1);
  });

  it('modes are independent: each continues its own dialog', async () => {
    const llm = scriptedLlm('solve 1', 'review 1', 'solve 2');
    const useCases = useCasesWith(llm);

    await analyzeAndStream(useCases, { agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] });
    useHudStore.getState().setAgentId('reviewer');
    await analyzeAndStream(useCases, { agent: AGENTS.reviewer, language: 'all', instructions: '', screenshots: [SHOT] });
    useHudStore.getState().setAgentId('solver');
    await analyzeAndStream(useCases, { agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] });

    expect(roles(llm.requests[1]!)).toEqual(['system', 'user']); // the review saw no solver history
    expect(textOf(llm.requests[2]!.messages[2])).toBe('solve 1'); // the solver saw only its own
    const { dialogs } = useHudStore.getState();
    expect(dialogs.solver?.turns.map((t) => t.answer)).toEqual(['solve 1', 'solve 2']);
    expect(dialogs.reviewer?.turns.map((t) => t.answer)).toEqual(['review 1']);
  });

  it('"New dialog" resets only the current mode', async () => {
    const llm = scriptedLlm('solve 1', 'review 1', 'solve 2');
    const useCases = useCasesWith(llm);
    await analyzeAndStream(useCases, { agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] });
    useHudStore.getState().setAgentId('reviewer');
    await analyzeAndStream(useCases, { agent: AGENTS.reviewer, language: 'all', instructions: '', screenshots: [SHOT] });
    useHudStore.getState().setAgentId('solver');

    useHudStore.getState().newDialog();

    let state = useHudStore.getState();
    expect(state.dialogs.solver).toBeNull();
    expect(state.answer).toBe('');
    expect(state.dialogs.reviewer?.turns).toHaveLength(1);

    await analyzeAndStream(useCases, { agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] });
    expect(roles(llm.requests[2]!)).toEqual(['system', 'user']); // clean context

    useHudStore.getState().setAgentId('reviewer');
    state = useHudStore.getState();
    expect(state.answer).toBe('review 1'); // the review dialog and its answer are intact
  });

  it('switching modes shows each mode\'s own answer area as it was left', async () => {
    const llm = scriptedLlm('solve 1');
    await analyzeAndStream(useCasesWith(llm), {
      agent: AGENTS.solver,
      language: 'all',
      instructions: 'hint',
      screenshots: [SHOT],
    });

    useHudStore.getState().setAgentId('reviewer');
    expect(useHudStore.getState()).toMatchObject({ answer: '', activeHint: '', lastRun: null });

    useHudStore.getState().setAgentId('solver');
    expect(useHudStore.getState()).toMatchObject({ answer: 'solve 1', activeHint: 'hint' });
  });

  it('a failed message leaves the dialog as it was', async () => {
    await analyzeAndStream(useCasesWith(scriptedLlm('answer A')), {
      agent: AGENTS.solver,
      language: 'all',
      instructions: '',
      screenshots: [SHOT],
    });
    await analyzeAndStream(useCasesWith(failingLlm), {
      agent: AGENTS.solver,
      language: 'all',
      instructions: '',
      screenshots: [SHOT],
    });

    expect(useHudStore.getState().error).toBe('boom');
    expect(useHudStore.getState().dialogs.solver?.turns.map((t) => t.answer)).toEqual(['answer A']);
  });

  it('replays screenshots only for a task that existed solely as pixels', async () => {
    const llm = scriptedLlm('A', 'B', 'C', 'D');
    const useCases = useCasesWith(llm);

    await analyzeAndStream(useCases, { agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] });
    useHudStore.setState({ instructions: 'q' });
    await runSend(useCases);
    expect(imagesIn(llm.requests[1]!)).toBe(1);

    useHudStore.getState().newDialog();
    await analyzeAndStream(useCases, {
      agent: AGENTS.solver,
      language: 'all',
      instructions: '',
      screenshots: [SHOT],
      codeText: 'task as text',
    });
    useHudStore.setState({ instructions: 'q' });
    await runSend(useCases);
    expect(imagesIn(llm.requests[3]!)).toBe(0);
  });

  it('keeps dialogs in memory only — the container has no persistence slice', () => {
    // 2026-10 review §2.4: nothing about a dialog is ever written to disk.
    const container = useCasesWith(scriptedLlm('A'));
    expect('recordConversation' in container).toBe(false);
  });
});

describe('DialogBar', () => {
  it('shows the context size and starts a new dialog', async () => {
    const onNewDialog = vi.fn();
    const { rerender } = render(<DialogBar turnCount={0} onNewDialog={onNewDialog} />);
    expect(screen.getByText('Новый диалог')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ Новый диалог' })).toBeDisabled();

    rerender(<DialogBar turnCount={3} onNewDialog={onNewDialog} />);
    expect(screen.getByText('В контексте: 3 вопроса')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '＋ Новый диалог' }));
    expect(onNewDialog).toHaveBeenCalled();

    rerender(<DialogBar turnCount={5} disabled onNewDialog={onNewDialog} />);
    expect(screen.getByText('В контексте: 5 вопросов')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ Новый диалог' })).toBeDisabled();
  });
});

describe('PromptInput', () => {
  it('says when the next message continues the dialog', () => {
    const { rerender } = render(<PromptInput value="" onChange={() => {}} onSubmit={() => {}} />);
    expect(screen.getByPlaceholderText('Подсказка к скриншоту или вопрос…')).toBeInTheDocument();
    rerender(<PromptInput value="" onChange={() => {}} onSubmit={() => {}} continuing />);
    expect(screen.getByPlaceholderText('Вопрос или подсказка — продолжение диалога…')).toBeInTheDocument();
  });
});
