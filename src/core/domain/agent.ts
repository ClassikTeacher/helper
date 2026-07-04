/**
 * Domain entity: an agent — one selectable "mode" of the assistant. Pure data.
 *
 * The app ships a fixed set of built-in agents (see `agents-catalog.ts`); there
 * is no user editing/persistence of agents (YAGNI — see decisions.md). Prompt
 * assembly (mixing in the language + user instructions) lives in the
 * application layer (`agent-prompt.ts`), so this stays plain data.
 */
export type AgentId = 'solver' | 'reviewer';

export interface Agent {
  readonly id: AgentId;
  readonly name: string;
  /** One-line description shown in the UI switch. */
  readonly description: string;
  /** Base system prompt describing the agent's job. */
  readonly systemPrompt: string;
  /**
   * Whether the UI offers a programming-language selector for this agent.
   * The solver needs it — a bare text task may not state a language. The
   * reviewer does not — the language is evident from the code's syntax, and
   * forcing a guess would only add room for error (user's requirement).
   */
  readonly requiresLanguage: boolean;
}
