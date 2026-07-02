import type { ModelRoute, ModelSlug, TaskKind } from '@/core/domain/model-route';

/**
 * Maps a task kind to an OpenRouter model slug. Pure and deterministic, so it is
 * trivially unit-testable (see tests/unit/model-router.test.ts).
 *
 * Model slugs are OpenRouter identifiers; verify current availability/IDs
 * against OpenRouter docs before shipping (see plan.md note).
 */
export type ModelRoutingTable = Readonly<Record<TaskKind, ModelSlug>>;

export const DEFAULT_ROUTING_TABLE: ModelRoutingTable = {
  'quick-answer': 'anthropic/claude-haiku-4.5',
  vision: 'google/gemini-3-flash-lite',
  reasoning: 'deepseek/deepseek-v4-flash',
  coding: 'anthropic/claude-haiku-4.5',
};

export class ModelRouter {
  constructor(private readonly table: ModelRoutingTable = DEFAULT_ROUTING_TABLE) {}

  route(task: TaskKind): ModelRoute {
    return { task, model: this.table[task] };
  }
}
