import type { StoragePort } from '@/core/application/ports/storage.port';
import type { AgentRepository } from '@/core/application/ports/agent.repository';
import type { Agent } from '@/core/domain/agent';
import type { TaskKind } from '@/core/domain/model-route';

interface AgentRow {
  id: string;
  name: string;
  system_prompt: string;
  task: string;
  tools_json: string;
}

/**
 * SQLite-backed AgentRepository.
 */
export class SqliteAgentRepository implements AgentRepository {
  constructor(private readonly storage: StoragePort) {}

  async getAll(): Promise<readonly Agent[]> {
    const rows = await this.storage.query<AgentRow>(
      `SELECT id, name, system_prompt, task, tools_json FROM agents ORDER BY name;`,
    );
    return rows.map(toAgent);
  }

  async getById(id: string): Promise<Agent | null> {
    const rows = await this.storage.query<AgentRow>(
      `SELECT id, name, system_prompt, task, tools_json FROM agents WHERE id = ?;`,
      [id],
    );
    const row = rows[0];
    return row ? toAgent(row) : null;
  }
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    systemPrompt: row.system_prompt,
    task: row.task as TaskKind,
    toolIds: JSON.parse(row.tools_json) as string[],
  };
}
