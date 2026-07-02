/**
 * Port: low-level SQL access. Repositories build on top of this; use-cases do
 * NOT use it directly. Implemented over `tauri-plugin-sql` (SQLite) or an
 * in-memory driver for tests.
 */
export interface StoragePort {
  /** Run a statement (INSERT/UPDATE/DELETE/DDL). */
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  /** Run a query and return typed rows. */
  query<TRow>(sql: string, params?: readonly unknown[]): Promise<TRow[]>;
}
