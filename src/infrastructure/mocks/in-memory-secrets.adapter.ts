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

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}
