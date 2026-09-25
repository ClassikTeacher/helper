/**
 * Domain value-objects for models. Pure — no I/O.
 *
 * Model choice is a resilient chain per ROUTE (a primary model plus an ordered
 * failover list), see `application/services/resilient-llm.ts` +
 * `bootstrap/model-chain.ts`. Agents do not pick a model slug: they declare the
 * route (task weight) they need — `light` or `heavy` — and the resilient layer
 * resolves it to a concrete chain and request profile.
 */

/** An OpenRouter model slug, e.g. "anthropic/claude-haiku-4.5". */
export type ModelSlug = string;

/**
 * Task weight an agent declares instead of a model slug (R11):
 * - `light` — latency matters most: the solver, plain text prompts. Default.
 * - `heavy` — depth matters most: the reviewer (the R3 baseline showed review
 *   quality is bounded by the model, while quick answers are not).
 */
export type ModelRoute = 'light' | 'heavy';

export const DEFAULT_ROUTE: ModelRoute = 'light';

export const MODEL_ROUTES: readonly ModelRoute[] = ['light', 'heavy'];

/**
 * OpenRouter's normalized reasoning effort (`reasoning.effort`). The model
 * thinks privately before answering; the thinking is excluded from the stream,
 * so the HUD only ever shows the answer.
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['low', 'medium', 'high'];

/**
 * Per-route request profile (R16): which models to try, and with which request
 * parameters. Sampling/reasoning/image size are properties of the ROUTE, not
 * global constants, because what suits a fast solver (low temperature, small
 * images) is wrong for a deep reviewer (reasoning, which is incompatible with a
 * custom temperature on Anthropic; larger images for models that accept them).
 */
export interface RouteProfile {
  /** Ordered failover chain: primary first. Non-empty, de-duplicated. */
  readonly chain: readonly ModelSlug[];
  /**
   * Sampling temperature. `undefined` = do not send the parameter at all (the
   * provider default applies). Always dropped when `reasoningEffort` is set —
   * see `requestParamsFor`.
   */
  readonly temperature?: number;
  /** Reasoning effort; `undefined` = no reasoning requested. */
  readonly reasoningEffort?: ReasoningEffort;
  /**
   * Longest image edge (px) sent to the model. Larger screenshots are
   * area-downscaled in native right before the request (R4/R17).
   */
  readonly maxImageEdge: number;
}

export type RouteProfiles = Readonly<Record<ModelRoute, RouteProfile>>;

/**
 * Default temperature (R5): low temperature trims chatter and stabilizes the
 * answer format. Applies only to routes without reasoning.
 */
export const DEFAULT_TEMPERATURE = 0.3;

/**
 * Default longest image edge (R4): Anthropic downscales anything above ~1568 px
 * on its side for Haiku-class models, so sending more only costs upload time
 * and (for tile-priced fallbacks) tokens.
 */
export const DEFAULT_MAX_IMAGE_EDGE = 1568;

/**
 * Upper bound for `maxImageEdge` (R17): the high-resolution threshold of the
 * Claude 5 family. A 2560×1440 frame passes through unscaled — the point is to
 * keep small code fonts legible on a heavy route (costs up to ~2.7× image
 * tokens per frame vs 1568). Captures are also capped to this in native.
 */
export const MAX_IMAGE_EDGE_LIMIT = 2576;

/** Lower bound for `maxImageEdge`: below this, code on a screenshot is unreadable. */
export const MIN_IMAGE_EDGE_LIMIT = 512;

/** Request parameters a profile contributes to one LLM call. */
export interface RouteRequestParams {
  readonly temperature?: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly maxImageEdge: number;
}

/**
 * The request parameters for a profile. Reasoning and a custom temperature are
 * mutually exclusive: Anthropic rejects a modified temperature together with
 * extended thinking, and a 400 is non-retryable (no failover would save it) —
 * so reasoning wins and the temperature is dropped.
 */
export function requestParamsFor(profile: RouteProfile): RouteRequestParams {
  if (profile.reasoningEffort) {
    return { reasoningEffort: profile.reasoningEffort, maxImageEdge: profile.maxImageEdge };
  }
  return {
    ...(profile.temperature !== undefined ? { temperature: profile.temperature } : {}),
    maxImageEdge: profile.maxImageEdge,
  };
}

/**
 * Catalog of models the app can call, keyed by a stable internal alias. Slugs
 * are OpenRouter identifiers and are PLACEHOLDERS — verify current
 * availability/IDs against OpenRouter docs before shipping (decisions.md §6).
 *
 * IMPORTANT — multimodality: the main scenario (screenshot → analysis) ALWAYS
 * sends an image, so every model on the failover chain must be MULTIMODAL.
 * `deepseek` here is a text-only model: safe for text-only prompts, but it must
 * NOT sit in the screenshot failover chain (it would reject the image).
 */
export const AVAILABLE_MODELS = {
  haiku: 'anthropic/claude-haiku-4.5', // multimodal
  sonnet: 'anthropic/claude-sonnet-5', // multimodal — candidate for the heavy route (R11)
  geminiFlashLite: 'google/gemini-3.1-flash-lite', // multimodal
  gpt4oMini: 'openai/gpt-4o-mini', // multimodal
  deepseek: 'deepseek/deepseek-v4-flash', // text-only — see note above
} as const satisfies Record<string, ModelSlug>;

/** Primary model tried first on every request. */
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
