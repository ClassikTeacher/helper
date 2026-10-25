import { useCallback, useEffect, useState } from 'react';
import { useServices } from './useServices';

export type ApiKeySaveStatus = 'idle' | 'saving' | 'saved' | 'clearing' | 'cleared' | 'error';

export interface ApiKeySettings {
  /** `null` while the initial check is in flight. */
  readonly hasKey: boolean | null;
  readonly status: ApiKeySaveStatus;
  readonly error: string | null;
  readonly save: (value: string) => Promise<void>;
  /** Remove the stored key from the OS keychain. */
  readonly clear: () => Promise<void>;
}

/**
 * Bridges the settings UI to `ManageApiKeyUseCase`. Loads the current
 * "is a key configured" status once on mount and exposes `save`/`clear` —
 * mirrors `useAnalyzeScreenshot`'s shape (hook = thin bridge to a use-case,
 * all logic lives in `core/application`). The key value itself never comes
 * back here: the use-case only ever answers "set / not set".
 */
export function useApiKeySettings(): ApiKeySettings {
  const { manageApiKey } = useServices();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ApiKeySaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    manageApiKey
      .hasApiKey()
      .then((value) => {
        if (!cancelled) setHasKey(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [manageApiKey]);

  const save = useCallback(
    async (value: string) => {
      setStatus('saving');
      setError(null);
      try {
        await manageApiKey.setApiKey(value);
        setHasKey(true);
        setStatus('saved');
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [manageApiKey],
  );

  const clear = useCallback(async () => {
    setStatus('clearing');
    setError(null);
    try {
      await manageApiKey.clearApiKey();
      setHasKey(false);
      setStatus('cleared');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [manageApiKey]);

  return { hasKey, status, error, save, clear };
}
