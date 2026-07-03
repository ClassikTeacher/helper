import { describe, it, expect } from 'vitest';
import { NodeSqliteStorageAdapter } from '../helpers/node-sqlite-storage';
import { applyMigrations, MIGRATIONS } from '@/infrastructure/persistence/migrations';

describe('applyMigrations', () => {
  it('creates the core tables', async () => {
    const storage = await NodeSqliteStorageAdapter.create();

    await applyMigrations(storage);

    const tables = await storage.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table';`,
    );
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['conversations', 'messages', 'agents', '_migrations']));
    storage.close();
  });

  it('records applied migrations and is idempotent on re-run', async () => {
    const storage = await NodeSqliteStorageAdapter.create();

    await applyMigrations(storage);
    await applyMigrations(storage); // second run must be a no-op, not an error

    const applied = await storage.query<{ id: number }>(`SELECT id FROM _migrations ORDER BY id;`);
    expect(applied.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
    storage.close();
  });
});
