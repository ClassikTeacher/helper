import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tauri-plugin-sql default export (a `Database` with static `load`).
// `vi.hoisted` so the mock fns exist when the hoisted `vi.mock` factory runs.
const { execute, select, load } = vi.hoisted(() => {
  const execute = vi.fn(async () => ({ rowsAffected: 1, lastInsertId: 0 }));
  const select = vi.fn(async () => [{ id: 'x' }]);
  const load = vi.fn(async () => ({ execute, select }));
  return { execute, select, load };
});
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load } }));

import {
  TauriStorageAdapter,
  toNumberedPlaceholders,
} from '@/infrastructure/persistence/tauri-storage.adapter';

describe('toNumberedPlaceholders', () => {
  it('rewrites ? to $1, $2, ... in order', () => {
    expect(toNumberedPlaceholders('INSERT INTO t (a, b, c) VALUES (?, ?, ?)')).toBe(
      'INSERT INTO t (a, b, c) VALUES ($1, $2, $3)',
    );
  });

  it('leaves placeholder-free SQL untouched', () => {
    expect(toNumberedPlaceholders('SELECT 1')).toBe('SELECT 1');
  });
});

describe('TauriStorageAdapter', () => {
  beforeEach(() => {
    execute.mockClear();
    select.mockClear();
    load.mockClear();
  });

  it('loads the database once and reuses the handle', async () => {
    const adapter = new TauriStorageAdapter();

    await adapter.execute('SELECT 1');
    await adapter.query('SELECT 1');

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('translates ? placeholders before executing', async () => {
    const adapter = new TauriStorageAdapter();

    await adapter.execute('INSERT INTO t VALUES (?, ?)', ['x', 1]);

    expect(execute).toHaveBeenCalledWith('INSERT INTO t VALUES ($1, $2)', ['x', 1]);
  });

  it('translates placeholders and returns rows from select', async () => {
    const adapter = new TauriStorageAdapter();

    const rows = await adapter.query('SELECT * FROM t WHERE id = ?', ['x']);

    expect(select).toHaveBeenCalledWith('SELECT * FROM t WHERE id = $1', ['x']);
    expect(rows).toEqual([{ id: 'x' }]);
  });
});
