import { describe, it, expect } from 'vitest';
import { ResilientLlm, dedupeModels } from '@/core/application/services/resilient-llm';
import type { LlmChunk, LlmPort, LlmStreamRequest } from '@/core/application/ports/llm.port';

/**
 * Scripted LlmPort: maps a model slug to the exact chunk sequence it emits, and
 * records the order of models actually attempted — the two things every
 * failover assertion needs.
 */
class ScriptedLlm implements LlmPort {
  readonly attempts: string[] = [];
  constructor(private readonly script: Record<string, LlmChunk[]>) {}
  async *stream(request: LlmStreamRequest): AsyncIterable<LlmChunk> {
    const model = request.model ?? '(unset)';
    this.attempts.push(model);
    for (const chunk of this.script[model] ?? []) yield chunk;
  }
}

const text = (delta: string): LlmChunk => ({ type: 'text-delta', delta });
const finish = (): LlmChunk => ({ type: 'finish', reason: 'stop' });
const err = (message: string, retryable: boolean): LlmChunk => ({ type: 'error', message, retryable });

async function collect(iterable: AsyncIterable<LlmChunk>): Promise<LlmChunk[]> {
  const out: LlmChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

describe('ResilientLlm', () => {
  it('uses the primary model when it succeeds, without touching fallbacks', async () => {
    const inner = new ScriptedLlm({ A: [text('hi '), finish()] });
    const llm = new ResilientLlm(inner, ['A', 'B']);

    const chunks = await collect(llm.stream({ messages: [] }));

    expect(inner.attempts).toEqual(['A']);
    expect(chunks).toEqual([text('hi '), finish()]);
  });

  it('fails over to the next model on a retryable pre-content error', async () => {
    const inner = new ScriptedLlm({
      A: [err('model A unavailable', true)],
      B: [text('from B '), finish()],
    });
    const llm = new ResilientLlm(inner, ['A', 'B']);

    const chunks = await collect(llm.stream({ messages: [] }));

    // A's retryable error is swallowed; B's answer streams through.
    expect(inner.attempts).toEqual(['A', 'B']);
    expect(chunks).toEqual([text('from B '), finish()]);
  });

  it('does NOT fail over on a non-retryable error (e.g. missing key)', async () => {
    const inner = new ScriptedLlm({
      A: [err('no api key', false)],
      B: [finish()],
    });
    const llm = new ResilientLlm(inner, ['A', 'B']);

    const chunks = await collect(llm.stream({ messages: [] }));

    expect(inner.attempts).toEqual(['A']);
    expect(chunks).toEqual([err('no api key', false)]);
  });

  it('does NOT fail over once content has streamed — a mid-stream error surfaces', async () => {
    const inner = new ScriptedLlm({
      A: [text('partial'), err('dropped mid-stream', true)],
      B: [finish()],
    });
    const llm = new ResilientLlm(inner, ['A', 'B']);

    const chunks = await collect(llm.stream({ messages: [] }));

    // Even though the error is retryable, content was already yielded — we
    // cannot swap models mid-answer, so B is never tried.
    expect(inner.attempts).toEqual(['A']);
    expect(chunks).toEqual([text('partial'), err('dropped mid-stream', true)]);
  });

  it('exhausts the whole chain then surfaces the last error', async () => {
    const inner = new ScriptedLlm({
      A: [err('A down', true)],
      B: [err('B down', true)],
    });
    const llm = new ResilientLlm(inner, ['A', 'B']);

    const chunks = await collect(llm.stream({ messages: [] }));

    expect(inner.attempts).toEqual(['A', 'B']);
    expect(chunks).toEqual([err('B down', true)]);
  });

  it('de-duplicates the chain so a repeated model is not tried twice', async () => {
    const inner = new ScriptedLlm({
      A: [err('A down', true)],
      B: [finish()],
    });
    const llm = new ResilientLlm(inner, ['A', 'A', 'B']);

    const chunks = await collect(llm.stream({ messages: [] }));

    expect(inner.attempts).toEqual(['A', 'B']);
    expect(chunks).toEqual([finish()]);
  });

  it('treats a caller-supplied request.model as the first attempt', async () => {
    const inner = new ScriptedLlm({
      A: [err('A down', true)],
      B: [finish()],
    });
    const llm = new ResilientLlm(inner, ['B']);

    const chunks = await collect(llm.stream({ model: 'A', messages: [] }));

    expect(inner.attempts).toEqual(['A', 'B']);
    expect(chunks).toEqual([finish()]);
  });

  it('rejects an empty model chain at construction', () => {
    const inner = new ScriptedLlm({});
    expect(() => new ResilientLlm(inner, [])).toThrow(/non-empty/);
    expect(() => new ResilientLlm(inner, ['', '  '])).toThrow(/non-empty/);
  });

  // Per-route chains (agents-improvement.md R11): a request names a WEIGHT and
  // gets the chain configured for it, so review can run on a stronger model.
  describe('routes', () => {
    const routed = { light: ['L1', 'L2'], heavy: ['H1', 'H2'] } as const;

    it('walks the chain configured for the requested route', async () => {
      const inner = new ScriptedLlm({ H1: [finish()] });
      const llm = new ResilientLlm(inner, routed);

      await collect(llm.stream({ route: 'heavy', messages: [] }));

      expect(inner.attempts).toEqual(['H1']);
    });

    it('falls back within the requested route only, never across routes', async () => {
      const inner = new ScriptedLlm({ H1: [err('H1 down', true)], H2: [finish()] });
      const llm = new ResilientLlm(inner, routed);

      await collect(llm.stream({ route: 'heavy', messages: [] }));

      // H1 -> H2, and the light chain is never touched.
      expect(inner.attempts).toEqual(['H1', 'H2']);
    });

    it('uses the default route when the request does not name one', async () => {
      const inner = new ScriptedLlm({ L1: [finish()] });
      const llm = new ResilientLlm(inner, routed);

      await collect(llm.stream({ messages: [] }));

      expect(inner.attempts).toEqual(['L1']);
    });

    it('treats a bare array as the same chain for every route', async () => {
      const inner = new ScriptedLlm({ A: [finish()] });
      const llm = new ResilientLlm(inner, ['A']);

      await collect(llm.stream({ route: 'heavy', messages: [] }));
      await collect(llm.stream({ route: 'light', messages: [] }));

      expect(inner.attempts).toEqual(['A', 'A']);
    });

    it('rejects a route whose chain is empty', () => {
      const inner = new ScriptedLlm({});
      expect(() => new ResilientLlm(inner, { light: ['A'], heavy: [] })).toThrow(/heavy/);
    });
  });
});

describe('dedupeModels', () => {
  it('preserves order and drops empties and duplicates', () => {
    expect(dedupeModels(['a', '', 'a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });
});
