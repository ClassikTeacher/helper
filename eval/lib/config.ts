import { REASONING_EFFORTS, type ReasoningEffort } from '@/core/domain/model-route';

/**
 * Eval grid configuration from env (R13). Every factor is a comma list; the
 * harness runs the full cross product × `EVAL_REPEATS`.
 */

export type InputMode = 'text' | 'shot' | 'text+shot';
export type PromptVariant = 'current' | 'main-2026-07-22';

export interface EvalConfig {
  readonly cases: readonly string[] | 'all';
  readonly models: readonly string[];
  readonly inputs: readonly InputMode[];
  readonly prompts: readonly PromptVariant[];
  /** Key into the case's shots/manifest.json (e.g. `dark-13px-1568`). */
  readonly shotVariant: string;
  readonly repeats: number;
  readonly temperature?: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly judgeModel: string;
  /** Judge temperature; `undefined` = not sent (`EVAL_JUDGE_TEMPERATURE=off`). Default 0. */
  readonly judgeTemperature?: number;
  readonly label: string;
  readonly concurrency: number;
  /** Re-score saved answers in this run dir instead of calling the models. */
  readonly scoreDir?: string;
}

const INPUTS: readonly InputMode[] = ['text', 'shot', 'text+shot'];
const PROMPTS: readonly PromptVariant[] = ['current', 'main-2026-07-22'];

function list(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

function oneOf<T extends string>(values: string[] | undefined, allowed: readonly T[], fallback: T[]): T[] {
  if (!values) return fallback;
  const bad = values.filter((v) => !allowed.includes(v as T));
  if (bad.length > 0) throw new Error(`invalid value(s) ${bad.join(', ')}; allowed: ${allowed.join(', ')}`);
  return values as T[];
}

function judgeTemperature(value: string | undefined): { judgeTemperature?: number } {
  const trimmed = value?.trim();
  if (trimmed === 'off') return {};
  const n = trimmed ? Number(trimmed) : 0;
  if (!Number.isFinite(n)) throw new Error('EVAL_JUDGE_TEMPERATURE must be a number or "off"');
  return { judgeTemperature: n };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Defaults = the first question to answer (factorial, R13): which gives the
 * gain — the model or the input? Haiku vs Sonnet 5 × text vs screenshot, 3
 * repeats each, current prompt, both cases.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): EvalConfig {
  const temperature = env.EVAL_TEMPERATURE?.trim();
  const reasoning = env.EVAL_REASONING?.trim().toLowerCase();
  if (reasoning && reasoning !== 'off' && !REASONING_EFFORTS.includes(reasoning as ReasoningEffort)) {
    throw new Error(`EVAL_REASONING must be off|low|medium|high, got ${reasoning}`);
  }
  const temp = temperature && temperature !== 'off' ? Number(temperature) : undefined;
  if (temp !== undefined && !Number.isFinite(temp)) throw new Error('EVAL_TEMPERATURE must be a number or "off"');

  return {
    cases: list(env.EVAL_CASES) ?? 'all',
    models: list(env.EVAL_MODELS) ?? ['anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-5'],
    inputs: oneOf(list(env.EVAL_INPUTS), INPUTS, ['text', 'shot']),
    prompts: oneOf(list(env.EVAL_PROMPTS), PROMPTS, ['current']),
    shotVariant: env.EVAL_SHOT_VARIANT?.trim() || 'dark-13px-1568',
    repeats: positiveInt(env.EVAL_REPEATS, 3),
    ...(temperature === undefined ? { temperature: 0.3 } : temp !== undefined ? { temperature: temp } : {}),
    ...(reasoning && reasoning !== 'off' ? { reasoningEffort: reasoning as ReasoningEffort } : {}),
    judgeModel: env.EVAL_JUDGE_MODEL?.trim() || 'anthropic/claude-sonnet-5',
    ...judgeTemperature(env.EVAL_JUDGE_TEMPERATURE),
    label: env.EVAL_LABEL?.trim() || 'grid',
    concurrency: positiveInt(env.EVAL_CONCURRENCY, 3),
    ...(env.EVAL_SCORE_DIR?.trim() ? { scoreDir: env.EVAL_SCORE_DIR.trim() } : {}),
  };
}
