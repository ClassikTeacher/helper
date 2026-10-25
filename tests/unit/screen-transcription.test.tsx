import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentRunner } from '@/core/application/services/agent-runner';
import {
  ScreenTranscriber,
  extractTranscription,
} from '@/core/application/services/screen-transcriber';
import { buildAgentPrompt } from '@/core/application/services/agent-prompt';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { buildTranscriberConfig } from '@/bootstrap/model-chain';
import { stopRun } from '@/bootstrap/run-control';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { AGENTS } from '@/core/domain/agents-catalog';
import { useHudStore } from '@/ui/store/hud.store';
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

describe('buildTranscriberConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is off by default and parses agent lists', () => {
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', '');
    expect(buildTranscriberConfig()).toBeNull();
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', 'reviewer');
    expect([...buildTranscriberConfig()!.agents]).toEqual(['reviewer']);
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', 'all');
    vi.stubEnv('VITE_TRANSCRIBE_MODEL', 'vendor/ocr');
    expect(buildTranscriberConfig()).toEqual({
      agents: new Set(['solver', 'reviewer']),
      engine: 'local',
      model: 'vendor/ocr',
    });
    vi.stubEnv('VITE_TRANSCRIBE_ENGINE', 'cloud');
    expect(buildTranscriberConfig()?.engine).toBe('cloud');
    vi.stubEnv('VITE_TRANSCRIBE_ENGINE', '');
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', 'nonsense');
    expect(buildTranscriberConfig()).toBeNull();
  });
});

describe('review regressions (P1 transcription)', () => {
  function useCasesWith(llm: LlmPort, extra: Partial<AppContainer['useCases']> = {}): AppContainer['useCases'] {
    return {
      analyzeScreenshot: new AnalyzeScreenshotUseCase(
        new AgentRunner({ screenCapture: new FakeScreenCaptureAdapter(), llm }),
      ),
      ...extra,
    } as AppContainer['useCases'];
  }

  beforeEach(() => {
    stopRun();
    useHudStore.getState().reset();
    useHudStore.setState({ instructions: '' });
  });

  it('a failing transcription pass degrades to screenshots only instead of failing the run', async () => {
    const llm: LlmPort & { calls: number } = {
      calls: 0,
      async *stream(request) {
        llm.calls++;
        if (request.temperature === 0) {
          yield { type: 'error', message: 'ocr model rejected images', retryable: false };
          return;
        }
        yield { type: 'text-delta', delta: 'answer from pixels' };
        yield { type: 'finish', reason: 'stop' };
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runner = new AgentRunner({
      screenCapture: new FakeScreenCaptureAdapter(),
      llm,
      transcriber: new ScreenTranscriber(llm, { agents: new Set(['solver']) }),
    });

    const answer = await drain(
      runner.analyzeScreen({ agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] }),
    );

    expect(answer).toBe('answer from pixels');
    expect(llm.calls).toBe(2);
    warn.mockRestore();
  });

  it('a second send while stopRecording() is still in flight backs off (no lost audio)', async () => {
    let releaseStop!: () => void;
    const audio = {
      stopRecording: vi.fn(() => new Promise<void>((r) => (releaseStop = r))),
      transcribe: vi.fn(async () => 'the question'),
      startRecording: vi.fn(async () => ({ maxSeconds: 60 })),
    };
    const llm = scriptedLlm('answer');
    const useCases = useCasesWith(llm, { transcribeAudio: audio as never });
    useHudStore.setState({ recording: true, screenshots: [SHOT] });

    const { runSend } = await import('@/bootstrap/send-batch');
    const first = runSend(useCases);
    await Promise.resolve();
    await runSend(useCases); // pressed again while the first is stopping the recorder
    releaseStop();
    await first;

    expect(audio.stopRecording).toHaveBeenCalledTimes(1);
    expect(audio.transcribe).toHaveBeenCalledTimes(1);
    expect(userTextOf(llm.requests[0])).toContain('<transcript>\nthe question\n</transcript>');
  });
});
