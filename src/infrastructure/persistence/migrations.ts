import type { StoragePort } from '@/core/application/ports/storage.port';

/**
 * Ordered, append-only migrations. Applied on startup. Never edit a shipped
 * migration — add a new one. Dates are stored as INTEGER (Unix epoch ms, UTC).
 */
export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: 'init',
    sql: `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        task TEXT NOT NULL,
        tools_json TEXT NOT NULL DEFAULT '[]'
      );
    `,
  },
  // Phase 4: add sqlite-vec embeddings table here as migration #2.
];

export async function applyMigrations(storage: StoragePort): Promise<void> {
  await storage.execute(
    `CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);`,
  );
  const applied = await storage.query<{ id: number }>(`SELECT id FROM _migrations;`);
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;
    await storage.execute(migration.sql);
    await storage.execute(`INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?);`, [
      migration.id,
      migration.name,
      Date.now(),
    ]);
  }
}
