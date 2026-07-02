/**
 * Port: read/write secrets from the OS keychain. Keys never live in code or the
 * renderer bundle (see security.md). Values are provided at runtime.
 */
export interface SecretsPort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/** Well-known secret keys. */
export const SECRET_KEYS = {
  openRouterApiKey: 'openrouter.api_key',
} as const;
