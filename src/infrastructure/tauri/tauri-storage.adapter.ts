import Database from '@tauri-apps/plugin-sql';
import type { StoragePort } from '@/core/application/ports/storage.port';

/**
 * Native adapter for StoragePort — SQLite via `tauri-plugin-sql`.
 * Construct via `TauriStorageAdapter.open(...)` so the async DB handle is ready.
 */
export class TauriStorageAdapter implements StoragePort {
  private constructor(private readonly db: Database) {}

  static async open(url = 'sqlite:ai-helper.db'): Promise<TauriStorageAdapter> {
    const db = await Database.load(url);
    return new TauriStorageAdapter(db);
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    await this.db.execute(sql, params as unknown[]);
  }

  async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
    return this.db.select<TRow[]>(sql, params as unknown[]);
  }
}
