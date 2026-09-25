import {
  DEFAULT_FALLBACKS,
  DEFAULT_MAX_IMAGE_EDGE,
  DEFAULT_MODEL,
  DEFAULT_TEMPERATURE,
  MAX_IMAGE_EDGE_LIMIT,
  MIN_IMAGE_EDGE_LIMIT,
  REASONING_EFFORTS,
  type ModelRoute,
  type ModelSlug,
  type ReasoningEffort,
  type RouteProfile,
  type RouteProfiles,
} from '@/core/domain/model-route';
import { dedupeModels } from '@/core/application/services/resilient-llm';

/**
 * Builds the BASE model chain from env, so the models can change without a
 * rebuild of the core:
 *
 *   VITE_DEFAULT_MODEL    -> the primary model, tried first
 *   VITE_MODEL_FALLBACKS  -> comma-separated fallback models, tried in order
 *                            when the primary (or a prior fallback) fails with
 *                            a retryable/provider-side error
 *
 * The returned chain is `[primary, ...fallbacks]`, de-duplicated in order — the
 * fallback list may legitimately repeat the primary, and we never want to try
 * the same model twice in a row. Each slot falls back to its compiled-in
 * default when its var is unset or blank.
 *
 * Reading `import.meta.env` is a composition-root concern (like `container.ts`
 * and `hotkeys.ts`); `ResilientLlm` itself just consumes what it's given.
 *
 * NB: the main scenario always sends a screenshot, so every model in the chain
 * must be MULTIMODAL — see the note on `AVAILABLE_MODELS` in model-route.ts.
 */
export function buildModelChain(): ModelSlug[] {
  const primary = pick(import.meta.env.VITE_DEFAULT_MODEL, DEFAULT_MODEL);
  const fallbacks = parseList(import.meta.env.VITE_MODEL_FALLBACKS) ?? DEFAULT_FALLBACKS;
  return dedupeModels([primary, ...fallbacks]);
}

/**
 * Builds a request profile per route (R11 + R16) from env. Every slot falls
 * back to the base value, so with no per-route vars set BOTH routes resolve to
 * the same chain and parameters — a seam, not a behavior switch:
 *
 *   VITE_{LIGHT,HEAVY}_MODEL              primary (default: VITE_DEFAULT_MODEL)
 *   VITE_{LIGHT,HEAVY}_MODEL_FALLBACKS    fallbacks (default: VITE_MODEL_FALLBACKS)
 *   VITE_{LIGHT,HEAVY}_TEMPERATURE        number, or "off" to not send it (default 0.3)
 *   VITE_{LIGHT,HEAVY}_REASONING          off | low | medium | high (default off)
 *   VITE_{LIGHT,HEAVY}_MAX_IMAGE_EDGE     px, 512–2576 (default 1568)
 *
 * Invalid values fall back to the default rather than failing startup: this is
 * a tuning surface, and a typo must not take the app down. Reasoning, when set,
 * suppresses the temperature (see `requestParamsFor`).
 */
export function buildModelRoutes(): RouteProfiles {
  const base = buildModelChain();
  return { light: buildRoute('LIGHT', base), heavy: buildRoute('HEAVY', base) };
}

type RoutePrefix = Uppercase<ModelRoute>;

function buildRoute(prefix: RoutePrefix, base: readonly ModelSlug[]): RouteProfile {
  const env = import.meta.env;
  const primary = pick(env[`VITE_${prefix}_MODEL`], base[0] ?? DEFAULT_MODEL);
  const fallbacks = parseList(env[`VITE_${prefix}_MODEL_FALLBACKS`]) ?? base.slice(1);
  const temperature = parseTemperature(env[`VITE_${prefix}_TEMPERATURE`]);
  const reasoningEffort = parseReasoning(env[`VITE_${prefix}_REASONING`]);
  return {
    chain: dedupeModels([primary, ...fallbacks]),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    maxImageEdge: parseImageEdge(env[`VITE_${prefix}_MAX_IMAGE_EDGE`]),
  };
}

/** Trimmed env value if non-empty, else the compiled-in default for that slot. */
function pick(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Parses a comma-separated model list, trimming each entry and dropping blanks.
 * Returns `undefined` when the var is unset or contains no usable entries, so
 * the caller can fall back to the default list (rather than an empty chain).
 */
function parseList(value: string | undefined): ModelSlug[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

/** `off` → not sent; a number in [0, 2] → that; unset/invalid → the default. */
export function parseTemperature(value: string | undefined): number | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return DEFAULT_TEMPERATURE;
  if (trimmed === 'off' || trimmed === 'none') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 && n <= 2 ? n : DEFAULT_TEMPERATURE;
}

/** `low|medium|high` → that effort; unset/`off`/invalid → no reasoning. */
export function parseReasoning(value: string | undefined): ReasoningEffort | undefined {
  const trimmed = value?.trim().toLowerCase();
  return REASONING_EFFORTS.find((effort) => effort === trimmed);
}

/** An integer edge in [MIN, MAX]; unset/invalid → the default. Out-of-range is clamped. */
export function parseImageEdge(value: string | undefined): number {
  const n = Number(value?.trim());
  if (!value?.trim() || !Number.isFinite(n)) return DEFAULT_MAX_IMAGE_EDGE;
  return Math.min(MAX_IMAGE_EDGE_LIMIT, Math.max(MIN_IMAGE_EDGE_LIMIT, Math.round(n)));
}
