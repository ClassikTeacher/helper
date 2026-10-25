/**
 * Port: the OS keychain, WRITE-ONLY from the renderer's point of view.
 *
 * The webview may ask whether a secret exists, store one, or delete one — it
 * can never read a value back. Values are read only by native code at the
 * moment it makes the provider call (`llm_stream`, `transcribe_audio`). This is
 * the secure-native invariant (architecture.md §11, decisions.md ADR #7): the
 * only time a secret touches the renderer is the moment the user types it in.
 */
export interface SecretsPort {
  /** Whether a non-empty value is stored under `key`. */
  has(key: string): Promise<boolean>;
  set(key: string, value: string): Promise<void>;
  /** Remove the secret; a key that is not set is not an error. */
  delete(key: string): Promise<void>;
}

/**
 * Well-known secret keys. Native accepts ONLY these (allow-list in
 * `commands/secrets.rs`); the string must match `OPENROUTER_API_KEY_SECRET`
 * there — it is the only thing tying the two sides together.
 */
export const SECRET_KEYS = {
  openRouterApiKey: 'openrouter.api_key',
} as const;
