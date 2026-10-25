import { SECRET_KEYS, type SecretsPort } from '@/core/application/ports/secrets.port';

/**
 * Use-case: configure the OpenRouter API key through `SecretsPort`. Thin on
 * purpose, but it exists so the settings UI depends on an application
 * use-case rather than a raw port — the same "UI only sees use-cases" rule
 * `AnalyzeScreenshotUseCase`/`CaptureScreenshotUseCase` already follow
 * (architecture.md §8).
 *
 * Exposes only `hasApiKey()` (a boolean), `setApiKey()` and `clearApiKey()`
 * — never the key value. The port itself has no read: once the user has
 * typed the key in, it lives in the OS keychain and is read only by native
 * code when it makes the provider call (architecture.md §11).
 */
export class ManageApiKeyUseCase {
  constructor(private readonly secrets: SecretsPort) {}

  hasApiKey(): Promise<boolean> {
    return this.secrets.has(SECRET_KEYS.openRouterApiKey);
  }

  setApiKey(value: string): Promise<void> {
    return this.secrets.set(SECRET_KEYS.openRouterApiKey, value);
  }

  clearApiKey(): Promise<void> {
    return this.secrets.delete(SECRET_KEYS.openRouterApiKey);
  }
}
