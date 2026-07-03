import {
  DEFAULT_ROUTING_TABLE,
  type ModelRoutingTable,
} from '@/core/application/services/model-router';

/**
 * Builds the task -> OpenRouter-slug routing table from env, so the models used
 * per scenario are configurable without a rebuild of the core:
 *
 *   quick-answer -> VITE_DEFAULT_MODEL
 *   vision       -> VITE_DEFAULT_MODEL_VISION
 *   reasoning    -> VITE_DEFAULT_MODEL_REASONING
 *   coding       -> VITE_DEFAULT_MODEL_CODING
 *
 * Reading `import.meta.env` is a composition-root concern (like `container.ts`
 * and `hotkeys.ts`); `ModelRouter` itself stays pure and just consumes the
 * table it's given (architecture.md §8). Each entry falls back to
 * `DEFAULT_ROUTING_TABLE` when its var is unset or blank, so a partial `.env`
 * only overrides the scenarios it names.
 */
export function envRoutingTable(): ModelRoutingTable {
  return {
    'quick-answer': pick(import.meta.env.VITE_DEFAULT_MODEL, DEFAULT_ROUTING_TABLE['quick-answer']),
    vision: pick(import.meta.env.VITE_DEFAULT_MODEL_VISION, DEFAULT_ROUTING_TABLE.vision),
    reasoning: pick(import.meta.env.VITE_DEFAULT_MODEL_REASONING, DEFAULT_ROUTING_TABLE.reasoning),
    coding: pick(import.meta.env.VITE_DEFAULT_MODEL_CODING, DEFAULT_ROUTING_TABLE.coding),
  };
}

/** Trimmed env value if non-empty, else the compiled-in default for that task. */
function pick(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}
