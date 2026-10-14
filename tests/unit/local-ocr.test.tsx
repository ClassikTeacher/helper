import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import { TauriOcrAdapter } from '@/infrastructure/tauri/tauri-ocr.adapter';
import { LocalScreenReader } from '@/core/application/services/local-screen-reader';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { analyzeAndStream } from '@/bootstrap/analyze-and-stream';
import { createContainer } from '@/bootstrap/container';
import { stopRun } from '@/bootstrap/run-control';
import { FakeOcrAdapter } from '@/infrastructure/mocks/fake-ocr.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { AGENTS } from '@/core/domain/agents-catalog';
import { useHudStore } from '@/ui/store/hud.store';
import type { OcrPort } from '@/core/application/ports/ocr.port';
import type { LlmChunk, LlmPort, LlmStreamRequest } from '@/core/application/ports/llm.port';
import type { AppContainer } from '@/bootstrap/container.types';

const SHOT = { imageBase64: 'img', width: 1, height: 1, capturedAt: 0 };

function recordingLlm(): LlmPort & { requests: LlmStreamRequest[] } {
  const requests: LlmStreamRequest[] = [];
  return {
    requests,
    async *stream(request): AsyncIterable<LlmChunk> {
      requests.push(request);
      yield { type: 'text-delta', delta: 'answer' };
      yield { type: 'finish', reason: 'stop' };
    },
  };
}

const userText = (req: LlmStreamRequest) =>
  req.messages
    .at(-1)!
    .parts.map((p) => (p.kind === 'text' ? p.text : ''))
    .join('');

const failingOcr: OcrPort = {
  recognize: async () => {
    throw new Error('локальный OCR не установлен — выполните `pnpm ocr:fetch`');
  },
};

describe('LocalScreenReader', () => {
  it('returns the OCR text of a single screenshot as is', async () => {
    const reader = new LocalScreenReader(new FakeOcrAdapter('x := 1\n'), new Set(['reviewer']));
    expect(await reader.transcribe([SHOT])).toBe('x := 1');
    expect(reader.appliesTo('reviewer')).toBe(true);
    expect(reader.appliesTo('solver')).toBe(false);
  });

  it('marks the seams between several screenshots and skips empty ones', async () => {
    let n = 0;
    const ocr: OcrPort = { recognize: async () => ({ fullText: ['a', '  ', 'c'][n++]!, boxes: [] }) };
    const reader = new LocalScreenReader(ocr, new Set(['solver']));
    expect(await reader.transcribe([SHOT, SHOT, SHOT])).toBe('[screenshot 1]\na\n\n[screenshot 3]\nc');
  });

  it('stops when aborted', async () => {
    const ocr = new FakeOcrAdapter('text');
    const controller = new AbortController();
    controller.abort();
    expect(await new LocalScreenReader(ocr, new Set(['solver'])).transcribe([SHOT], controller.signal)).toBe('');
    expect(ocr.calls).toHaveLength(0);
  });
});

describe('AgentRunner with the local OCR', () => {
  it('sends the OCR text as a machine transcription next to the screenshots', async () => {
    const llm = recordingLlm();
    const runner = new AgentRunner({
      screenCapture: new FakeScreenCaptureAdapter(),
      llm,
      transcriber: new LocalScreenReader(new FakeOcrAdapter('func f() {}'), new Set(['reviewer'])),
    });
    let sent: { images?: readonly string[] } = {};
    for await (const _ of runner.analyzeScreen({
      agent: AGENTS.reviewer,
      language: 'all',
      instructions: '',
      screenshots: [SHOT],
      onPrompt: (p) => (sent = p),
    })) {
      // drain
    }

    expect(llm.requests).toHaveLength(1); // no extra model call
    const req = llm.requests[0]!;
    expect(req.messages.at(-1)!.parts.map((p) => p.kind)).toEqual(['image', 'text']);
    expect(userText(req)).toContain('Machine transcription');
    expect(userText(req)).toContain('<code_text>\nfunc f() {}\n</code_text>');
    // The text carries the task: the dialog history will not replay the image.
    expect(sent.images).toBeUndefined();
  });
});

describe('a failed OCR pass', () => {
  beforeEach(() => {
    stopRun();
    useHudStore.getState().reset();
    useHudStore.setState({ instructions: '' });
  });

  it('still answers from the screenshots and tells the user why', async () => {
    const llm = recordingLlm();
    const useCases = {
      analyzeScreenshot: new AnalyzeScreenshotUseCase(
        new AgentRunner({
          screenCapture: new FakeScreenCaptureAdapter(),
          llm,
          transcriber: new LocalScreenReader(failingOcr, new Set(['solver'])),
        }),
      ),
    } as AppContainer['useCases'];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await analyzeAndStream(useCases, { agent: AGENTS.solver, language: 'all', instructions: '', screenshots: [SHOT] });

    const state = useHudStore.getState();
    expect(state.answer).toBe('answer');
    expect(state.error).toBeNull();
    expect(state.notice).toContain('pnpm ocr:fetch');
    expect(userText(llm.requests[0]!)).not.toContain('<code_text>');

    // The next answer starts without the old caveat.
    useHudStore.getState().startStreaming();
    expect(useHudStore.getState().notice).toBeNull();
    warn.mockRestore();
  });
});

describe('container wiring of the OCR pass', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses the local OCR by default once the pass is enabled', async () => {
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', 'all');
    vi.stubEnv('VITE_TRANSCRIBE_ENGINE', '');
    const ocr = new FakeOcrAdapter('select 1');
    const llm = recordingLlm();
    const container = createContainer({ llm, ocr, screenCapture: new FakeScreenCaptureAdapter() });
    for await (const _ of container.useCases.analyzeScreenshot.execute({
      agent: AGENTS.solver,
      language: 'all',
      instructions: '',
      screenshots: [SHOT],
    })) {
      // drain
    }
    expect(ocr.calls).toHaveLength(1);
    expect(llm.requests).toHaveLength(1);
    expect(userText(llm.requests[0]!)).toContain('select 1');
  });

  it('uses a model call with VITE_TRANSCRIBE_ENGINE=cloud', async () => {
    vi.stubEnv('VITE_AUTO_TRANSCRIBE', 'all');
    vi.stubEnv('VITE_TRANSCRIBE_ENGINE', 'cloud');
    const ocr = new FakeOcrAdapter('never');
    const llm = recordingLlm();
    const container = createContainer({ llm, ocr, screenCapture: new FakeScreenCaptureAdapter() });
    for await (const _ of container.useCases.analyzeScreenshot.execute({
      agent: AGENTS.solver,
      language: 'all',
      instructions: '',
      screenshots: [SHOT],
    })) {
      // drain
    }
    expect(ocr.calls).toHaveLength(0);
    expect(llm.requests).toHaveLength(2); // transcription call + answer
  });
});

describe('TauriOcrAdapter', () => {
  it('invokes ocr_image and maps the result', async () => {
    vi.mocked(invoke).mockResolvedValue({
      fullText: 'a\nb',
      boxes: [{ text: 'a', confidence: 0.9, box: { x: 1, y: 2, width: 3, height: 4 } }],
    });
    const result = await new TauriOcrAdapter().recognize(SHOT);
    expect(invoke).toHaveBeenCalledWith(IPC_COMMANDS.ocrImage, { request: { imageBase64: 'img' } });
    expect(result).toEqual({ fullText: 'a\nb', boxes: [{ text: 'a', confidence: 0.9 }] });
  });
});
