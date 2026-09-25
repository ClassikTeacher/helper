import { describe, it, expect } from 'vitest';
import { ResilientLlm, dedupeModels } from '@/core/application/services/resilient-llm';
import type { LlmChunk, LlmPort, LlmStreamRequest } from '@/core/application/ports/llm.port';
import { requestParamsFor, type RouteProfiles } from '@/core/domain/model-route';

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
/** A finish as ResilientLlm re-emits it: annotated with the serving model (R19). */
const served = (model: string, fallback = false): LlmChunk => ({
  type: 'finish',
  reason: 'stop',
  model,
  fallback,
});
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
    expect(chunks).toEqual([text('hi '), served('A')]);
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
    expect(chunks).toEqual([text('from B '), served('B', true)]);
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
    expect(chunks).toEqual([served('B', true)]);
  });

  it('treats a caller-supplied request.model as the first attempt', async () => {
    const inner = new ScriptedLlm({
      A: [err('A down', true)],
      B: [finish()],
    });
    const llm = new ResilientLlm(inner, ['B']);

    const chunks = await collect(llm.stream({ model: 'A', messages: [] }));

    expect(inner.attempts).toEqual(['A', 'B']);
    // B is the configured primary — not a fallback, even though it was tried second.
    expect(chunks).toEqual([served('B', false)]);
  });

  it('rejects an empty model chain at construction', () => {
    const inner = new ScriptedLlm({});
    expect(() => new ResilientLlm(inner, [])).toThrow(/non-empty/);
    expect(() => new ResilientLlm(inner, ['', '  '])).toThrow(/non-empty/);
  });
});

/** Records every request the inner port receives. */
class RecordingLlm implements LlmPort {
  readonly requests: LlmStreamRequest[] = [];
  constructor(private readonly reportedModel?: string) {}
  async *stream(request: LlmStreamRequest): AsyncIterable<LlmChunk> {
    this.requests.push(request);
    yield {
      type: 'finish',
      reason: 'stop',
      ...(this.reportedModel ? { model: this.reportedModel } : {}),
    };
  }
}

const PROFILES: RouteProfiles = {
  light: { chain: ['fast/a', 'fast/b'], temperature: 0.3, maxImageEdge: 1568 },
  heavy: { chain: ['deep/a'], reasoningEffort: 'medium', temperature: 0.3, maxImageEdge: 2576 },
};

describe('ResilientLlm routes and request profiles (R11/R16)', () => {
  it('resolves the light route by default and applies its profile parameters', async () => {
    const inner = new RecordingLlm();
    await collect(new ResilientLlm(inner, PROFILES).stream({ messages: [] }));

    expect(inner.requests[0]).toMatchObject({ model: 'fast/a', temperature: 0.3, maxImageEdge: 1568 });
    expect(inner.requests[0]).not.toHaveProperty('reasoningEffort');
    expect(inner.requests[0]).not.toHaveProperty('route');
  });

  it('resolves the heavy route to its own chain; reasoning drops the temperature', async () => {
    const inner = new RecordingLlm();
    await collect(new ResilientLlm(inner, PROFILES).stream({ route: 'heavy', messages: [] }));

    expect(inner.requests[0]).toMatchObject({
      model: 'deep/a',
      reasoningEffort: 'medium',
      maxImageEdge: 2576,
    });
    expect(inner.requests[0]).not.toHaveProperty('temperature');
  });

  it('lets explicit request parameters override the profile (eval sweeps)', async () => {
    const inner = new RecordingLlm();
    await collect(
      new ResilientLlm(inner, PROFILES).stream({
        route: 'light',
        messages: [],
        reasoningEffort: 'high',
        maxImageEdge: 2000,
      }),
    );

    // Caller added reasoning → the PROFILE temperature must not ride along.
    expect(inner.requests[0]).toMatchObject({ reasoningEffort: 'high', maxImageEdge: 2000 });
    expect(inner.requests[0]).not.toHaveProperty('temperature');
  });

  it('prefers the model the provider reports over the attempted slug', async () => {
    const inner = new RecordingLlm('fast/a-2026-01-01');
    const chunks = await collect(new ResilientLlm(inner, PROFILES).stream({ messages: [] }));

    expect(chunks).toEqual([served('fast/a-2026-01-01')]);
  });

  it("does not flag the route's own primary as a fallback after a caller model fails over", async () => {
    const inner = new ScriptedLlm({
      'caller/x': [err('x down', true)],
      'fast/a': [finish()],
    });
    const chunks = await collect(
      new ResilientLlm(inner, PROFILES).stream({ model: 'caller/x', messages: [] }),
    );
    expect(chunks).toEqual([served('fast/a', false)]);
  });

  it('drops an explicit temperature too when reasoning is on (one rule for every path)', async () => {
    const inner = new RecordingLlm();
    await collect(
      new ResilientLlm(inner, PROFILES).stream({ messages: [], temperature: 0.9, reasoningEffort: 'low' }),
    );
    expect(inner.requests[0]).not.toHaveProperty('temperature');
    expect(inner.requests[0]).toMatchObject({ reasoningEffort: 'low' });
  });

  it('rejects a route profile with an empty chain', () => {
    expect(
      () => new ResilientLlm(new RecordingLlm(), { ...PROFILES, heavy: { ...PROFILES.heavy, chain: [] } }),
    ).toThrow(/non-empty/);
  });
});

describe('ResilientLlm cancellation (P0)', () => {
  it('does not fail over when the caller aborted before any content', async () => {
    const controller = new AbortController();
    const attempts: string[] = [];
    const inner: LlmPort = {
      async *stream(request) {
        attempts.push(request.model ?? '');
        controller.abort(); // user pressed Stop while waiting for the first token
        // An aborted adapter ends without a terminal chunk.
        if (!controller.signal.aborted) yield { type: 'finish', reason: 'stop' };
      },
    };

    const chunks = await collect(new ResilientLlm(inner, ['A', 'B']).stream({ messages: [], signal: controller.signal }));

    expect(attempts).toEqual(['A']);
    expect(chunks).toEqual([]);
  });
});

describe('requestParamsFor', () => {
  it('omits an unset temperature and keeps the image edge', () => {
    expect(requestParamsFor({ chain: ['a'], maxImageEdge: 1568 })).toEqual({ maxImageEdge: 1568 });
  });
});

describe('dedupeModels', () => {
  it('preserves order and drops empties and duplicates', () => {
    expect(dedupeModels(['a', '', 'a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });
});
