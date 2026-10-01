import { DEFAULT_MODEL, DEFAULT_FALLBACKS } from '@/core/domain/model-route';
import type { ModelChains, ModelSlug } from '@/core/domain/model-route';
import { dedupeModels } from '@/core/application/services/resilient-llm';

/**
 * Builds the ordered model chains the resilient LLM layer walks on failure —
 * one chain PER ROUTE (see `ModelRoute`), from env, so the models can change
 * without a rebuild of the core.
 *
 * Base chain (applies to every route unless overridden):
 *   VITE_DEFAULT_MODEL    -> the primary model, tried first
 *   VITE_MODEL_FALLBACKS  -> comma-separated fallback models, tried in order
 *                            when the primary (or a prior fallback) fails with
 *                            a retryable/provider-side error
 *
 * Per-route overrides — this is the seam that lets code review run on a
 * stronger model than plain questions (agents-improvement.md R11):
 *   VITE_LIGHT_MODEL / VITE_LIGHT_MODEL_FALLBACKS  -> solver, plain prompts
 *   VITE_HEAVY_MODEL / VITE_HEAVY_MODEL_FALLBACKS  -> reviewer
 *
 * Each slot falls back to the base slot, and the base falls back to the
 * compiled-in defaults. With no per-route vars set — the current shipping
 * configuration — both routes resolve to the SAME chain, so this is a seam,
 * not a behaviour change.
 *
 * The returned chains are `[primary, ...fallbacks]`, de-duplicated in order —
 * the fallback list may legitimately repeat the primary, and we never want to
 * try the same model twice in a row.
 *
 * Reading `import.meta.env` is a composition-root concern (like `container.ts`
 * and `hotkeys.ts`); `ResilientLlm` itself just consumes the chains it's given.
 * Each var is read as a LITERAL member access, because that is the only form
 * Vite statically replaces at build time (`import.meta.env[key]` would be
 * `undefined` in a production bundle).
 *
 * NB: the main scenario always sends a screenshot, so every model in every
 * chain must be MULTIMODAL — see the note on `AVAILABLE_MODELS` in
 * model-route.ts.
 */
export function buildModelChains(): ModelChains {
  const basePrimary = pick(import.meta.env.VITE_DEFAULT_MODEL, DEFAULT_MODEL);
  const baseFallbacks = parseList(import.meta.env.VITE_MODEL_FALLBACKS) ?? DEFAULT_FALLBACKS;

  const chain = (primary: string | undefined, fallbacks: string | undefined): ModelSlug[] =>
    dedupeModels([pick(primary, basePrimary), ...(parseList(fallbacks) ?? baseFallbacks)]);

  return {
    light: chain(import.meta.env.VITE_LIGHT_MODEL, import.meta.env.VITE_LIGHT_MODEL_FALLBACKS),
    heavy: chain(import.meta.env.VITE_HEAVY_MODEL, import.meta.env.VITE_HEAVY_MODEL_FALLBACKS),
  };
}

/** Trimmed env value if non-empty, else the default for that slot. */
function pick(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Parses a comma-separated model list, trimming each entry and dropping blanks.
 * Returns `undefined` when the var is unset or contains no usable entries, so
 * the caller can fall back to the next slot (base list, then compiled-in
 * defaults) rather than an empty chain.
 */
function parseList(value: string | undefined): ModelSlug[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}
