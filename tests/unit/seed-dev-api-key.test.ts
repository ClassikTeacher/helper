import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { seedDevApiKey } from '@/bootstrap/seed-dev-api-key';
import { ManageApiKeyUseCase } from '@/core/application/use-cases/manage-api-key.use-case';
import { InMemorySecretsAdapter } from '@/infrastructure/mocks/in-memory-secrets.adapter';
import { SECRET_KEYS } from '@/core/application/ports/secrets.port';
import type { SecretsPort } from '@/core/application/ports/secrets.port';
import type { AppContainer } from '@/bootstrap/container.types';

/** Minimal container slice `seedDevApiKey` consumes, backed by a real use-case. */
function createContainer(secrets: SecretsPort): Pick<AppContainer, 'useCases'> {
  return {
    useCases: {
      manageApiKey: new ManageApiKeyUseCase(secrets),
    } as AppContainer['useCases'],
  };
}

describe('seedDevApiKey', () => {
  // vitest runs in dev mode, so `import.meta.env.DEV` is already true here —
  // the guard under test is the presence/emptiness of the key, which we drive
  // via a stubbed `VITE_OPENROUTER_API_KEY`.
  beforeEach(() => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'sk-or-test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('writes the env key into an empty keychain', async () => {
    const secrets = new InMemorySecretsAdapter();

    await seedDevApiKey(createContainer(secrets));

    expect(await secrets.get(SECRET_KEYS.openRouterApiKey)).toBe('sk-or-test-key');
  });

  it('does not overwrite a key the user already configured', async () => {
    const secrets = new InMemorySecretsAdapter();
    await secrets.set(SECRET_KEYS.openRouterApiKey, 'sk-or-user-entered');

    await seedDevApiKey(createContainer(secrets));

    expect(await secrets.get(SECRET_KEYS.openRouterApiKey)).toBe('sk-or-user-entered');
  });

  it('is a no-op when no env key is provided', async () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', '');
    const secrets = new InMemorySecretsAdapter();

    await seedDevApiKey(createContainer(secrets));

    expect(await secrets.get(SECRET_KEYS.openRouterApiKey)).toBeNull();
  });

  it('never throws when the keychain write fails', async () => {
    const failing: SecretsPort = {
      get: async () => null,
      set: async () => {
        throw new Error('keychain unavailable');
      },
    };

    await expect(seedDevApiKey(createContainer(failing))).resolves.toBeUndefined();
  });
});
