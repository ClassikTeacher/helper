/**
 * Domain value-objects for models. Pure — no I/O.
 *
 * Model choice is a single resilient chain (a primary `DEFAULT_MODEL` plus an
 * ordered failover list), see `application/services/resilient-llm.ts` +
 * `bootstrap/model-chain.ts`. Agents (phase 5) do not select a model.
 */

/** An OpenRouter model slug, e.g. "anthropic/claude-haiku-4.5". */
export type ModelSlug = string;

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
