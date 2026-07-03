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
  // Vector recall (deferred): the `embeddings` vec0 table lands as migration #2
  // together with the recall work. It can't be defined yet — a `vec0` virtual
  // table needs a FIXED vector dimension, which depends on the (still
  // undecided) embedding model. The sqlite-vec EXTENSION is already registered
  // process-wide at native startup (lib.rs), so the table will "just work" when
  // added. Keeping it out now also keeps this list portable so the SQLite repos
  // can be unit-tested against a plain in-memory SQLite (no vec extension).
];

export async function applyMigrations(storage: StoragePort): Promise<void> {
  await storage.execute(
    `CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);`,
  );
  const applied = await storage.query<{ id: number }>(`SELECT id FROM _migrations;`);
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) continue;

    // Run the migration DDL and its bookkeeping row as ONE atomic unit, so a
    // crash between them can't leave a migration half-applied and un-recorded
    // (which would re-run it on restart — unsafe once a migration is
    // non-idempotent, e.g. ALTER/backfill).
    //
    // It must be a SINGLE execute() call: tauri-plugin-sql runs SQL on a
    // connection POOL, so BEGIN/COMMIT split across separate execute() calls
    // could land on different connections and not form one transaction. A
    // multi-statement string can't carry bind params, so the bookkeeping values
    // are inlined — all trusted, compile-time constants (never user input).
    const name = migration.name.replace(/'/g, "''");
    await storage.execute(
      `BEGIN;
${migration.sql}
INSERT INTO _migrations (id, name, applied_at) VALUES (${migration.id}, '${name}', ${Date.now()});
COMMIT;`,
    );
  }
}
