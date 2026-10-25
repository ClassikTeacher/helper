import type { SecretsPort } from '@/core/application/ports/secrets.port';

/**
 * SecretsPort for dev (browser-only `pnpm dev`) and tests — in-memory only,
 * lost on reload/process exit. The real persistence path is native
 * (`TauriSecretsAdapter` -> OS keychain, see decisions.md "SecretStore");
 * this exists only so the Settings UI is exercisable outside a Tauri window
 * without crashing on a missing `invoke` bridge.
 */
export class InMemorySecretsAdapter implements SecretsPort {
  private readonly store = new Map<string, string>();

  async has(key: string): Promise<boolean> {
    // Same rule as native `secret_has`: a blank value is "not set".
    return (this.store.get(key) ?? '').trim().length > 0;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * TEST-ONLY: the stored value. Deliberately NOT part of `SecretsPort` — the
   * port is write-only by design; tests use this to assert what was written.
   */
  peek(key: string): string | null {
    return this.store.get(key) ?? null;
  }
}
