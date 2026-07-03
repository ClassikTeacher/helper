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
});

describe('dedupeModels', () => {
  it('preserves order and drops empties and duplicates', () => {
    expect(dedupeModels(['a', '', 'a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });
});
