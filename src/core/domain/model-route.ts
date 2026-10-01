/**
 * Domain value-objects for models. Pure — no I/O.
 *
 * Model choice is a set of resilient chains (a primary model plus an ordered
 * failover list), keyed by ROUTE — see `ModelRoute` below. The chains are built
 * from env in `bootstrap/model-chain.ts` and walked by
 * `application/services/resilient-llm.ts`. Agents do not name a model; they
 * name a route (`Agent.modelRoute`), so swapping the model behind "heavy" is an
 * env change, not a code change.
 */

/** An OpenRouter model slug, e.g. "anthropic/claude-haiku-4.5". */
export type ModelSlug = string;

/**
 * Which class of model a request should be served by. Deliberately named after
 * the WEIGHT of the task, not after the agent, so a future third agent just
 * picks a weight instead of forcing a new route:
 *
 * - `light` — fast turnaround matters most: theory questions, straightforward
 *   coding tasks, plain text prompts. This is the default for anything that
 *   doesn't ask for a route.
 * - `heavy` — depth matters more than latency: code review, where a missed bug
 *   costs far more than a slower first token.
 *
 * Both routes resolve to the SAME chain unless the per-route env vars are set
 * (see `buildModelChains`), so this is a seam, not a behaviour change.
 */
export type ModelRoute = 'light' | 'heavy';

/** Route used when a request doesn't name one (plain prompts, tests). */
export const DEFAULT_ROUTE: ModelRoute = 'light';

/** Every route, for iteration (env parsing, tests). */
export const MODEL_ROUTES: readonly ModelRoute[] = ['light', 'heavy'];

/** The ordered failover chain to walk, per route. */
export type ModelChains = Readonly<Record<ModelRoute, readonly ModelSlug[]>>;

/** Same chain for every route — the current (single-chain) configuration. */
export function uniformChains(chain: readonly ModelSlug[]): ModelChains {
  return { light: chain, heavy: chain };
}

/**
 * Catalog of models the app can call, keyed by a stable internal alias. Slugs
 * are OpenRouter identifiers and are PLACEHOLDERS — verify current
 * availability/IDs against OpenRouter docs before shipping (decisions.md §6).
 *
 * IMPORTANT — multimodality: the main scenario (screenshot → analysis) ALWAYS
 * sends an image, so every model on a failover chain must be MULTIMODAL.
 * `deepseek` here is a text-only model: safe for text-only prompts, but it must
 * NOT sit in the screenshot failover chain (it would reject the image).
 *
 * ⚠️ `sonnet` is listed as the intended `heavy` candidate but is NOT wired in
 * yet: Claude 5-family models reject non-default sampling parameters with a
 * 400, and `openrouter_client.rs` sends `temperature` on every request (a 400
 * is classified non-retryable, so failover would not rescue it). Verify that
 * with one live request before pointing `VITE_HEAVY_MODEL` at it.
 */
export const AVAILABLE_MODELS = {
  haiku: 'anthropic/claude-haiku-4.5', // multimodal
  sonnet: 'anthropic/claude-sonnet-5', // multimodal — see the temperature caveat above
  geminiFlashLite: 'google/gemini-3.1-flash-lite', // multimodal
  gpt4oMini: 'openai/gpt-4o-mini', // multimodal
  deepseek: 'deepseek/deepseek-v4-flash', // text-only — see note above
} as const satisfies Record<string, ModelSlug>;

/** Primary model tried first on every request, for every route. */
export const DEFAULT_MODEL: ModelSlug = AVAILABLE_MODELS.haiku;

/**
 * Ordered failover list, tried in turn when the primary (or a prior fallback)
 * fails with a retryable/provider-side error. Spread across different providers
 * on purpose, so one provider's outage doesn't take the app down. Multimodal
 * only, because the screenshot path always carries an image.
 */
export const DEFAULT_FALLBACKS: readonly ModelSlug[] = [
  AVAILABLE_MODELS.geminiFlashLite,
  AVAILABLE_MODELS.gpt4oMini,
];
