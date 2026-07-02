/**
 * Domain value-objects for model routing. Pure — no I/O.
 *
 * A `TaskKind` describes what the agent is doing; the ModelRouter maps it to a
 * concrete OpenRouter model slug (see application/services/model-router.ts).
 */
export type TaskKind =
  | 'quick-answer' // cheap, low latency (default)
  | 'vision' // screenshot understanding
  | 'reasoning' // harder multi-step tasks
  | 'coding';

/** An OpenRouter model slug, e.g. "anthropic/claude-haiku-4.5". */
export type ModelSlug = string;

export interface ModelRoute {
  readonly task: TaskKind;
  readonly model: ModelSlug;
}
