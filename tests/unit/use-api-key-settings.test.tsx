import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useApiKeySettings } from '@/ui/hooks/useApiKeySettings';
import { ServicesProvider } from '@/bootstrap/ServicesProvider';
import { createContainer } from '@/bootstrap/container';
import { InMemorySecretsAdapter } from '@/infrastructure/mocks/in-memory-secrets.adapter';
import { SECRET_KEYS } from '@/core/application/ports/secrets.port';
import type { PropsWithChildren } from 'react';

function wrapperWithContainer(container: ReturnType<typeof createContainer>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <ServicesProvider container={container}>{children}</ServicesProvider>;
  };
}

describe('useApiKeySettings', () => {
  it('reports hasKey=false after loading when nothing is configured yet', async () => {
    const container = createContainer({ secrets: new InMemorySecretsAdapter() });
    const { result } = renderHook(() => useApiKeySettings(), { wrapper: wrapperWithContainer(container) });

    expect(result.current.hasKey).toBeNull(); // loading
    await waitFor(() => expect(result.current.hasKey).toBe(false));
  });

  it('reports hasKey=true when a key is already stored', async () => {
    const secrets = new InMemorySecretsAdapter();
    await secrets.set(SECRET_KEYS.openRouterApiKey, 'sk-or-v1-existing');
    const container = createContainer({ secrets });
    const { result } = renderHook(() => useApiKeySettings(), { wrapper: wrapperWithContainer(container) });

    await waitFor(() => expect(result.current.hasKey).toBe(true));
  });

  it('save() persists the key and flips hasKey to true', async () => {
    const secrets = new InMemorySecretsAdapter();
    const container = createContainer({ secrets });
    const { result } = renderHook(() => useApiKeySettings(), { wrapper: wrapperWithContainer(container) });
    await waitFor(() => expect(result.current.hasKey).toBe(false));

    await act(async () => {
      await result.current.save('sk-or-v1-new');
    });

    expect(result.current.hasKey).toBe(true);
    expect(result.current.status).toBe('saved');
    expect(result.current.error).toBeNull();
    expect(await secrets.get(SECRET_KEYS.openRouterApiKey)).toBe('sk-or-v1-new');
  });

  it('surfaces a save failure via status/error instead of throwing', async () => {
    const failingSecrets = {
      get: async () => null,
      set: async () => {
        throw new Error('keychain write failed');
      },
    };
    const container = createContainer({ secrets: failingSecrets });
    const { result } = renderHook(() => useApiKeySettings(), { wrapper: wrapperWithContainer(container) });
    await waitFor(() => expect(result.current.hasKey).toBe(false));

    await act(async () => {
      await result.current.save('sk-or-v1-new');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('keychain write failed');
    expect(result.current.hasKey).toBe(false);
  });
});
