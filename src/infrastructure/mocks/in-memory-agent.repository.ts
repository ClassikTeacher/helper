import type { AgentRepository } from '@/core/application/ports/agent.repository';
import type { Agent } from '@/core/domain/agent';

/**
 * In-memory AgentRepository for tests and browser-only dev. Optionally seeded
 * with a fixed set of agents.
 */
export class InMemoryAgentRepository implements AgentRepository {
  private readonly store = new Map<string, Agent>();

  constructor(seed: readonly Agent[] = []) {
    for (const agent of seed) this.store.set(agent.id, agent);
  }

  async getAll(): Promise<readonly Agent[]> {
    return [...this.store.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getById(id: string): Promise<Agent | null> {
    return this.store.get(id) ?? null;
  }
}
