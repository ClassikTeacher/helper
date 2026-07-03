import { DEFAULT_MODEL, DEFAULT_FALLBACKS, type ModelSlug } from '@/core/domain/model-route';
import { dedupeModels } from '@/core/application/services/resilient-llm';

/**
 * Builds the ordered model chain the resilient LLM layer walks on failure,
 * from env, so the models can change without a rebuild of the core:
 *
 *   VITE_DEFAULT_MODEL    -> the primary model, tried first
 *   VITE_MODEL_FALLBACKS  -> comma-separated fallback models, tried in order
 *                            when the primary (or a prior fallback) fails with
 *                            a retryable/provider-side error
 *
 * The returned chain is `[primary, ...fallbacks]`, de-duplicated in order — the
 * fallback list may legitimately repeat the primary (the user was told it
 * "partly overlaps" with DEFAULT_MODEL), and we never want to try the same
 * model twice in a row. Each slot falls back to its compiled-in default when
 * its var is unset or blank.
 *
 * Reading `import.meta.env` is a composition-root concern (like `container.ts`
 * and `hotkeys.ts`); `ResilientLlm` itself just consumes the chain it's given.
 *
 * NB: the main scenario always sends a screenshot, so every model in the chain
 * must be MULTIMODAL — see the note on `AVAILABLE_MODELS` in model-route.ts.
 */
export function buildModelChain(): ModelSlug[] {
  const primary = pick(import.meta.env.VITE_DEFAULT_MODEL, DEFAULT_MODEL);
  const fallbacks = parseList(import.meta.env.VITE_MODEL_FALLBACKS) ?? DEFAULT_FALLBACKS;
  return dedupeModels([primary, ...fallbacks]);
}

/** Trimmed env value if non-empty, else the compiled-in default for that slot. */
function pick(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Parses a comma-separated model list, trimming each entry and dropping blanks.
 * Returns `undefined` when the var is unset or contains no usable entries, so
 * the caller can fall back to the compiled-in default list (rather than an
 * empty chain).
 */
function parseList(value: string | undefined): ModelSlug[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}
