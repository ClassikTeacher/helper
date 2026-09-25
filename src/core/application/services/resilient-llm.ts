import type { LlmChunk, LlmPort, LlmStreamRequest } from '@/core/application/ports/llm.port';
import {
  DEFAULT_MAX_IMAGE_EDGE,
  DEFAULT_ROUTE,
  requestParamsFor,
  withSamplingRule,
  type ModelSlug,
  type RouteProfile,
  type RouteProfiles,
} from '@/core/domain/model-route';

/**
 * Failover decorator over an `LlmPort`. Owns model selection: it resolves the
 * request's ROUTE (`light`/`heavy`, R11) to a route profile — an ordered chain
 * of models plus request parameters (R16) — walks the chain (primary first,
 * then fallbacks) and, when a model fails with a *retryable* provider-side
 * error BEFORE any content has streamed, transparently retries the request on
 * the next model in the chain.
 *
 * Why "before any content": once we've yielded `text-delta`s to the caller
 * (already rendered in the HUD), we can't cleanly swap models mid-answer
 * without duplicating or replacing visible output. So failover only applies to
 * failures that happen at request time (model unavailable, 429/5xx, network) —
 * exactly the "provider is down / model unavailable" case. A mid-stream break,
 * or any non-retryable error (missing key, auth, bad request — see
 * `LlmError.retryable`), is surfaced as-is.
 *
 * The terminal `finish` chunk is annotated with the model that answered and
 * whether it was a fallback (R19), so the HUD can show a silent quality drop.
 *
 * This is the ONLY place model choice lives; use-cases call
 * `stream({ route, messages })` without a model. Pure orchestration — no
 * framework, no Tauri, no fetch — so the failover logic is unit-tested against
 * a scripted fake (see tests/unit/resilient-llm.test.ts).
 */
export class ResilientLlm implements LlmPort {
  private readonly routes: RouteProfiles;

  /**
   * @param routes a profile per route, or a bare chain — shorthand for "both
   *   routes use this chain, with no extra request parameters".
   */
  constructor(
    private readonly inner: LlmPort,
    routes: RouteProfiles | readonly ModelSlug[],
  ) {
    this.routes = isChain(routes)
      ? { light: bareProfile(routes), heavy: bareProfile(routes) }
      : { light: normalizeProfile(routes.light), heavy: normalizeProfile(routes.heavy) };
  }

  async *stream(request: LlmStreamRequest): AsyncIterable<LlmChunk> {
    const profile = this.routes[request.route ?? DEFAULT_ROUTE];
    const params = requestParamsFor(profile);
    // Profile parameters, overridden by any the caller set explicitly (the
    // eval harness sweeps them). `route` is consumed here — adapters below
    // only ever see a concrete model + parameters.
    const { route: _route, ...rest } = request;
    // The reasoning-vs-temperature rule is applied once, to the merged result.
    const base: LlmStreamRequest = withSamplingRule({
      ...params,
      ...stripUndefined(rest),
      messages: request.messages,
    });

    // A caller-supplied model (rare — tests/dev) becomes the first attempt,
    // then the configured chain follows as fallbacks; otherwise use the chain
    // as-is. De-duplicated so a primary that also appears in the fallback list
    // isn't tried twice.
    const chain = request.model ? dedupeModels([request.model, ...profile.chain]) : profile.chain;

    for (const [i, model] of chain.entries()) {
      const isLast = i === chain.length - 1;
      let produced = false;

      for await (const chunk of this.inner.stream({ ...base, model })) {
        if (chunk.type === 'text-delta') {
          produced = true;
          yield chunk;
        } else if (chunk.type === 'finish') {
          // A fallback = neither what the caller asked for nor the route's primary.
          const fallback = model !== chain[0] && model !== profile.chain[0];
          yield { ...chunk, model: chunk.model ?? model, fallback };
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
      // stop; otherwise fall through to the next model — unless the caller
      // aborted: an aborted stream also ends without a terminal chunk, and it
      // must NOT be mistaken for a provider failure and re-sent to a fallback.
      if (produced || isLast || request.signal?.aborted) return;
    }
  }
}

function isChain(routes: RouteProfiles | readonly ModelSlug[]): routes is readonly ModelSlug[] {
  return Array.isArray(routes);
}

function bareProfile(chain: readonly ModelSlug[]): RouteProfile {
  return normalizeProfile({ chain, maxImageEdge: DEFAULT_MAX_IMAGE_EDGE });
}

function normalizeProfile(profile: RouteProfile): RouteProfile {
  const chain = dedupeModels(profile.chain);
  if (chain.length === 0) {
    throw new Error('ResilientLlm requires a non-empty model chain for every route');
  }
  return { ...profile, chain };
}

/** Drops keys whose value is `undefined`, so they don't override profile values. */
function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
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
