import { describe, it, expect } from 'vitest';
import { ManageApiKeyUseCase } from '@/core/application/use-cases/manage-api-key.use-case';
import { InMemorySecretsAdapter } from '@/infrastructure/mocks/in-memory-secrets.adapter';
import { SECRET_KEYS } from '@/core/application/ports/secrets.port';

describe('ManageApiKeyUseCase', () => {
  it('reports no key configured before anything is saved', async () => {
    const useCase = new ManageApiKeyUseCase(new InMemorySecretsAdapter());
    expect(await useCase.hasApiKey()).toBe(false);
  });

  it('reports a key as configured after saving one', async () => {
    const useCase = new ManageApiKeyUseCase(new InMemorySecretsAdapter());
    await useCase.setApiKey('sk-or-v1-example');
    expect(await useCase.hasApiKey()).toBe(true);
  });

  it('stores the key under the well-known secret key shared with native `llm_stream`', async () => {
    // The wire-level seam between TS and `OPENROUTER_API_KEY_SECRET` in
    // commands/llm.rs is this exact string — a typo here would silently
    // break the whole secure-native path (llm_stream would just never find
    // the key `secret_set` wrote).
    const secrets = new InMemorySecretsAdapter();
    const useCase = new ManageApiKeyUseCase(secrets);
    await useCase.setApiKey('sk-or-v1-example');
    expect(await secrets.get(SECRET_KEYS.openRouterApiKey)).toBe('sk-or-v1-example');
  });

  it('treats an empty stored value the same as "not configured"', async () => {
    const secrets = new InMemorySecretsAdapter();
    await secrets.set(SECRET_KEYS.openRouterApiKey, '');
    const useCase = new ManageApiKeyUseCase(secrets);
    expect(await useCase.hasApiKey()).toBe(false);
  });
});
