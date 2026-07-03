import type { StoragePort } from '@/core/application/ports/storage.port';

/**
 * Minimal slice of Node's built-in `node:sqlite` API (Node 22.5+). It ships no
 * TypeScript types without `@types/node` (which this project doesn't install),
 * so we declare only what we use.
 */
interface NodeStatement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeStatement;
  close(): void;
}
interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeDatabase;
}

// `node:sqlite` isn't in Vite's builtin-externals list, so any import of it
// (static OR dynamic) gets (mis)resolved to `sqlite` by the bundler. Reach the
// builtin directly via `process.getBuiltinModule` (Node 22.3+), which bypasses
// the module loader entirely. `process` is a Node global (untyped here — no
// @types/node), available in Vitest even under the jsdom environment.
declare const process: { getBuiltinModule(id: string): unknown };

/**
 * StoragePort backed by a real in-memory SQLite via `node:sqlite`. Lets the
 * SQLite repositories run against genuine SQL — FK enforcement, ON CONFLICT,
 * ORDER BY — with zero external dependencies (architecture.md §10: "реальные
 * репозитории на in-memory SQLite"). Uses `?` placeholders, matching the
 * StoragePort contract. Built via the async `create()` factory (the module is
 * loaded lazily).
 */
export class NodeSqliteStorageAdapter implements StoragePort {
  private constructor(private readonly db: NodeDatabase) {}

  static async create(): Promise<NodeSqliteStorageAdapter> {
    const mod = process.getBuiltinModule('node:sqlite') as NodeSqliteModule;
    const db = new mod.DatabaseSync(':memory:');
    // Match sqlx's default (decisions.md §6): FK checks on, unlike raw SQLite.
    db.exec('PRAGMA foreign_keys = ON;');
    return new NodeSqliteStorageAdapter(db);
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    if (params.length === 0) {
      this.db.exec(sql); // multi-statement DDL (migrations)
      return;
    }
    this.db.prepare(sql).run(...params);
  }

  async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
    return this.db.prepare(sql).all(...params) as TRow[];
  }

  close(): void {
    this.db.close();
  }
}
