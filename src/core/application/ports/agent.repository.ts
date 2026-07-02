import type { Agent } from '@/core/domain/agent';

/**
 * Port (repository): agent definitions.
 */
export interface AgentRepository {
  getAll(): Promise<readonly Agent[]>;
  getById(id: string): Promise<Agent | null>;
}
