import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentRunner } from '@/core/application/services/agent-runner';
import {
  ScreenTranscriber,
  extractTranscription,
} from '@/core/application/services/screen-transcriber';
import { buildAgentPrompt } from '@/core/application/services/agent-prompt';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { analyzeAndStream, MAX_THREAD_TURNS } from '@/bootstrap/analyze-and-stream';
import { runFollowUp } from '@/bootstrap/send-batch';
import { buildTranscriberConfig } from '@/bootstrap/model-chain';
import { stopRun } from '@/bootstrap/run-control';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { AGENTS } from '@/core/domain/agents-catalog';
import { useHudStore } from '@/ui/store/hud.store';
import { PromptInput } from '@/ui/components/PromptInput';
import type { LlmChunk, LlmPort, LlmStreamRequest } from '@/core/application/ports/llm.port';
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

const SHOT = { imageBase64: 'img', width: 1, height: 1, capturedAt: 0 };

async function drain(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const d of it) out += d;
  return out;
}

const userTextOf = (req: LlmStreamRequest | undefined) =>
  req?.messages
    .find((m) => m.role === 'user')
    ?.parts.filter((p) => p.kind === 'text')
    .map((p) => (p.kind === 'text' ? p.text : ''))
    .join('') ?? '';

describe('ScreenTranscriber (P1 item 7)', () => {
  it('extracts the fenced block, or keeps a bare reply', () => {
    expect(extractTranscription('```go\nx := 1\n```\n')).toBe('x := 1');
    expect(extractTranscription('plain text  \n')).toBe('plain text');
    expect(extractTranscription('```\n```')).toBe('');
  });

  it('sends the screenshots at temperature 0 on the light route with the configured model', async () => {
    const llm = scriptedLlm('```\nfunc f() {}\n```');
    const t = new ScreenTranscriber(llm, { agents: new Set(['reviewer']), model: 'vendor/ocr' });

    expect(await t.transcribe([SHOT, SHOT])).toBe('func f() {}');
    const req = llm.requests[0]!;
    expect(req).toMatchObject({ route: 'light', model: 'vendor/ocr', temperature: 0 });
    expect(req.messages[1]!.parts.filter((p) => p.kind === 'image')).toHaveLength(2);
    expect(t.appliesTo('reviewer')).toBe(true);
    expect(t.appliesTo('solver')).toBe(false);
  });
});

describe('AgentRunner with the transcription pass', () => {
  it('adds the machine transcription as an un-numbered <code_text> next to the screenshots', async () => {
    const llm = scriptedLlm('```\nx := 1\n```', 'review');
    const onStatus = vi.fn();
    const runner = new AgentRunner({
      screenCapture: new FakeScreenCaptureAdapter(),
      llm,
      transcriber: new ScreenTranscriber(llm, { agents: new Set(['reviewer']) }),
    });

    const answer = await drain(
      runner.analyzeScreen({
        agent: AGENTS.reviewer,
        language: 'all',
        instructions: '',
        screenshots: [SHOT],
        onStatus,
      }),
    );

    expect(answer).toBe('review');
    expect(onStatus).toHaveBeenCalledWith('reading-screen');
    const main = llm.requests[1]!;
    expect(main.messages[1]!.parts.map((p) => p.kind)).toEqual(['image', 'text']);
    const text = userTextOf(main);
    expect(text).toContain('<code_text>\nx := 1\n</code_text>');
    expect(text).toContain('Machine transcription');
    expect(text).not.toContain('1| x := 1');
  });

  it('skips the pass for other agents and when the user already gave the code', async () => {
    const llm = scriptedLlm();
    const runner = new AgentRunner({
      screenCapture: new FakeScreenCaptureAdapter(),
      llm,
      transcriber: new ScreenTranscriber(llm, { agents: new Set(['reviewer']) }),
    });
    await drain(runner.analyzeScreen({ agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] }));
    await drain(
      runner.analyzeScreen({ agent: AGENTS.reviewer, language: 'all', instructions: '', screenshots: [SHOT], codeText: 'y' }),
    );
    expect(llm.requests).toHaveLength(2); // no transcription calls
  });

  it('prompt: transcribed code tells the model the screenshots win on conflicts', () => {
    const { userText } = buildAgentPrompt({
      agent: AGENTS.reviewer,
      language: 'all',
      instructions: '',
      codeText: 'a\nb',
      codeTextSource: 'transcribed',
    });
    expect(userText).toContain('the screenshots win');
    expect(userText).toContain('<code_text>\na\nb\n</code_text>');
    expect(userText).toContain('checking doubtful characters against the screenshots');
  });
});

describe('AgentRunner.followUp (P1 item 9)', () => {
  it('sends the thread as text turns and the question last — no images', async () => {
    const llm = scriptedLlm('shorter answer');
    const runner = new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm });

    await drain(
      runner.followUp({
        agent: AGENTS.solver,
        history: [{ userText: 'task text', answer: 'first answer' }],
        question: 'а без доп. памяти?',
      }),
    );

    const req = llm.requests[0]!;
    expect(req.route).toBe('light');
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(req.messages.flatMap((m) => m.parts).some((p) => p.kind === 'image')).toBe(false);
    expect(userTextOf({ ...req, messages: [req.messages[3]!] })).toContain(
      '<follow_up>\nа без доп. памяти?\n</follow_up>',
    );
  });
});

describe('follow-up threads in the HUD flow', () => {
  function useCasesWith(llm: LlmPort): AppContainer['useCases'] {
    return {
      analyzeScreenshot: new AnalyzeScreenshotUseCase(
        new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm }),
      ),
    } as AppContainer['useCases'];
  }

  beforeEach(() => {
    stopRun();
    useHudStore.getState().reset();
    useHudStore.setState({ instructions: '' });
  });

  it('an analysis starts a thread; a follow-up extends it and clears the question', async () => {
    const llm = scriptedLlm('answer 1', 'answer 2');
    const useCases = useCasesWith(llm);
    await analyzeAndStream(useCases, { agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] });
    expect(useHudStore.getState().thread?.turns).toHaveLength(1);

    useHudStore.setState({ instructions: 'а за O(1) памяти?' });
    await runFollowUp(useCases);

    const state = useHudStore.getState();
    expect(state.answer).toBe('answer 2');
    expect(state.thread?.turns.map((t) => t.answer)).toEqual(['answer 1', 'answer 2']);
    expect(state.instructions).toBe('');
    expect(state.activeHint).toBe('↳ а за O(1) памяти?');
    // The follow-up request carried the first exchange.
    expect(llm.requests[1]!.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('keeps the first turn (the task) and the latest ones when the thread grows', async () => {
    const llm = scriptedLlm(...Array.from({ length: 10 }, (_, i) => `a${i}`));
    const useCases = useCasesWith(llm);
    await analyzeAndStream(useCases, { agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] });
    for (let i = 0; i < 5; i++) {
      useHudStore.setState({ instructions: `q${i}` });
      await runFollowUp(useCases);
    }
    const answers = useHudStore.getState().thread!.turns.map((t) => t.answer);
    expect(answers).toHaveLength(MAX_THREAD_TURNS);
    expect(answers[0]).toBe('a0');
    expect(answers.at(-1)).toBe('a5');
  });

  it('a follow-up without a thread or without a question does nothing', async () => {
    const llm = scriptedLlm();
    useHudStore.setState({ instructions: 'q' });
    await runFollowUp(useCasesWith(llm));
    expect(llm.requests).toHaveLength(0);
  });
});

describe('buildTranscriberConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off by default and parses agent lists', () => {
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', '');
    expect(buildTranscriberConfig()).toBeNull();
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', 'reviewer');
    expect([...buildTranscriberConfig()!.agents]).toEqual(['reviewer']);
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', 'all');
    vi.stubEnv('VITE_TRANSCRIBE_MODEL', 'vendor/ocr');
    expect(buildTranscriberConfig()).toEqual({ agents: new Set(['solver', 'reviewer']), model: 'vendor/ocr' });
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', 'nonsense');
    expect(buildTranscriberConfig()).toBeNull();
  });
});

describe('PromptInput follow-up button', () => {
  it('appears with a thread and needs a question', async () => {
    const onFollowUp = vi.fn();
    const { rerender } = render(
      <PromptInput value="" onChange={() => {}} onSubmit={() => {}} onFollowUp={onFollowUp} canFollowUp />,
    );
    expect(screen.getByRole('button', { name: '↳ Уточнить' })).toBeDisabled();

    rerender(<PromptInput value="why?" onChange={() => {}} onSubmit={() => {}} onFollowUp={onFollowUp} canFollowUp />);
    await userEvent.click(screen.getByRole('button', { name: '↳ Уточнить' }));
    expect(onFollowUp).toHaveBeenCalled();

    rerender(<PromptInput value="x" onChange={() => {}} onSubmit={() => {}} />);
    expect(screen.queryByRole('button', { name: '↳ Уточнить' })).not.toBeInTheDocument();
  });
});
