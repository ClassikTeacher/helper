import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import { TauriSecretsAdapter } from '@/infrastructure/tauri/tauri-secrets.adapter';

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

/**
 * The secrets seam is write-only (2026-10 review §2.1): the adapter may only
 * ever ask "is it set?", set, or delete. No command returning a value exists,
 * and these tests pin that down at the IPC-name level.
 */
describe('TauriSecretsAdapter', () => {
  it('has() asks secret_has and returns only the boolean', async () => {
    mockInvoke.mockResolvedValue({ exists: true });
    const exists = await new TauriSecretsAdapter().has('openrouter.api_key');

    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.secretHas, {
      request: { key: 'openrouter.api_key' },
    });
    expect(exists).toBe(true);
  });

  it('set() sends the value INTO native via secret_set', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await new TauriSecretsAdapter().set('openrouter.api_key', 'sk-or-v1-x');

    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.secretSet, {
      request: { key: 'openrouter.api_key', value: 'sk-or-v1-x' },
    });
  });

  it('delete() calls secret_delete', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await new TauriSecretsAdapter().delete('openrouter.api_key');

    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.secretDelete, {
      request: { key: 'openrouter.api_key' },
    });
  });

  it('the contract has no command that could return a secret value', () => {
    const names = Object.values(IPC_COMMANDS) as string[];
    expect(names).not.toContain('secret_get');
    expect(names.filter((n) => n.startsWith('secret_')).sort()).toEqual([
      'secret_delete',
      'secret_has',
      'secret_set',
    ]);
  });
});
