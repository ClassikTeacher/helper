import Database from '@tauri-apps/plugin-sql';
import type { StoragePort } from '@/core/application/ports/storage.port';

/** SQLite file, relative to the app config dir (tauri-plugin-sql convention). */
const DB_URL = 'sqlite:ai-helper.db';

/**
 * StoragePort over `tauri-plugin-sql` (SQLite) — the production storage driver.
 * Repositories build on top of this; use-cases never touch it directly.
 *
 * The database handle is loaded lazily and memoized, so the whole app shares a
 * single connection pool (one `Database.load` per adapter instance).
 */
export class TauriStorageAdapter implements StoragePort {
  private handle: Promise<Database> | undefined;

  private db(): Promise<Database> {
    return (this.handle ??= Database.load(DB_URL));
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    const db = await this.db();
    await db.execute(toNumberedPlaceholders(sql), params as unknown[]);
  }

  async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
    const db = await this.db();
    return db.select<TRow[]>(toNumberedPlaceholders(sql), params as unknown[]);
  }
}

/**
 * Translates the StoragePort's `?` placeholders into tauri-plugin-sql's SQLite
 * dialect (`$1, $2, …`). The port contract uses `?` — driver-agnostic and what
 * the in-memory test driver (`node:sqlite`) binds natively — so only this
 * adapter needs to know its driver wants numbered `$N` (see the plugin README:
 * "sqlite and postgres use the `$#` syntax").
 *
 * NB: assumes `?` only ever appears as a bind placeholder, never inside a string
 * literal — true for all repository SQL in this project.
 */
export function toNumberedPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}
