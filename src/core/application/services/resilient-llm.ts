import type { LlmChunk, LlmPort, LlmStreamRequest } from '@/core/application/ports/llm.port';
import type { ModelSlug } from '@/core/domain/model-route';

/**
 * Failover decorator over an `LlmPort`. Owns model selection: it walks an
 * ordered chain of models (primary first, then fallbacks) and, when a model
 * fails with a *retryable* provider-side error BEFORE any content has streamed,
 * transparently retries the request on the next model in the chain.
 *
 * Why "before any content": once we've yielded `text-delta`s to the caller
 * (already rendered in the HUD), we can't cleanly swap models mid-answer
 * without duplicating or replacing visible output. So failover only applies to
 * failures that happen at request time (model unavailable, 429/5xx, network) —
 * exactly the "provider is down / model unavailable" case. A mid-stream break,
 * or any non-retryable error (missing key, auth, bad request — see
 * `LlmError.retryable`), is surfaced as-is.
 *
 * This is the ONLY place model choice lives; use-cases call `stream({ messages })`
 * without a model. Pure orchestration — no framework, no Tauri, no fetch — so
 * the failover logic is unit-tested against a scripted fake (see
 * tests/unit/resilient-llm.test.ts).
 */
export class ResilientLlm implements LlmPort {
  private readonly chain: readonly ModelSlug[];

  constructor(
    private readonly inner: LlmPort,
    chain: readonly ModelSlug[],
  ) {
    const deduped = dedupeModels(chain);
    if (deduped.length === 0) {
      throw new Error('ResilientLlm requires a non-empty model chain');
    }
    this.chain = deduped;
  }

  async *stream(request: LlmStreamRequest): AsyncIterable<LlmChunk> {
    // A caller-supplied model (rare — tests/dev) becomes the first attempt,
    // then the configured chain follows as fallbacks; otherwise use the chain
    // as-is. De-duplicated so a primary that also appears in the fallback list
    // isn't tried twice.
    const chain = request.model ? dedupeModels([request.model, ...this.chain]) : this.chain;

    for (const [i, model] of chain.entries()) {
      const isLast = i === chain.length - 1;
      let produced = false;

      for await (const chunk of this.inner.stream({ ...request, model })) {
        if (chunk.type === 'text-delta') {
          produced = true;
          yield chunk;
        } else if (chunk.type === 'finish') {
          yield chunk;
          return;
        } else {
          // error chunk
          const canFailOver = !produced && !isLast && chunk.retryable;
          if (!canFailOver) {
            yield chunk; // last model, non-retryable, or mid-stream — surface it
            return;
          }
          break; // swallow this retryable pre-content error, try the next model
        }
      }

      // Reached via a failover `break`, or an inner stream that ended without a
      // terminal chunk. If we already produced content or exhausted the chain,
      // stop; otherwise fall through to the next model.
      if (produced || isLast) return;
    }
  }
}

/** Order-preserving de-duplication, trimming entries and dropping blanks. */
export function dedupeModels(models: readonly ModelSlug[]): ModelSlug[] {
  const seen = new Set<ModelSlug>();
  const out: ModelSlug[] = [];
  for (const model of models) {
    const slug = model.trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}
