/**
 * Domain entity: an agent definition (prompt + model + tools). Pure data.
 * Tool execution and prompt assembly live in the application layer.
 */
import type { TaskKind } from './model-route';

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  /** Preferred task kind used by the model router. */
  readonly task: TaskKind;
  /** Tool ids this agent may call (resolved by the runner). */
  readonly toolIds: readonly string[];
}
