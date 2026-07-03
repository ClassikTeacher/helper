import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeSqliteStorageAdapter } from '../helpers/node-sqlite-storage';
import { applyMigrations } from '@/infrastructure/persistence/migrations';
import { SqliteAgentRepository } from '@/infrastructure/persistence/sqlite-agent.repository';

const INSERT = `INSERT INTO agents (id, name, system_prompt, task, tools_json) VALUES (?, ?, ?, ?, ?);`;

describe('SqliteAgentRepository', () => {
  let storage: NodeSqliteStorageAdapter;
  let repo: SqliteAgentRepository;

  beforeEach(async () => {
    storage = await NodeSqliteStorageAdapter.create();
    await applyMigrations(storage);
    repo = new SqliteAgentRepository(storage);
    await storage.execute(INSERT, ['a1', 'Zeta', 'sys', 'vision', '["t1","t2"]']);
    await storage.execute(INSERT, ['a2', 'Alpha', 'sys2', 'coding', '[]']);
  });

  afterEach(() => storage.close());

  it('getAll returns agents ordered by name, parsing tools_json', async () => {
    const agents = await repo.getAll();

    expect(agents.map((a) => a.name)).toEqual(['Alpha', 'Zeta']);
    expect(agents.find((a) => a.id === 'a1')?.toolIds).toEqual(['t1', 't2']);
    expect(agents.find((a) => a.id === 'a2')?.toolIds).toEqual([]);
  });

  it('getById returns the mapped agent or null', async () => {
    const agent = await repo.getById('a2');
    expect(agent?.name).toBe('Alpha');
    expect(agent?.task).toBe('coding');
    expect(await repo.getById('missing')).toBeNull();
  });
});
