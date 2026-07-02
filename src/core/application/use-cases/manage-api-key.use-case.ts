import { SECRET_KEYS, type SecretsPort } from '@/core/application/ports/secrets.port';

/**
 * Use-case: configure the OpenRouter API key through `SecretsPort`. Thin on
 * purpose, but it exists so the settings UI depends on an application
 * use-case rather than a raw port — the same "UI only sees use-cases" rule
 * `AnalyzeScreenshotUseCase`/`CaptureScreenshotUseCase` already follow
 * (architecture.md §8).
 *
 * Deliberately exposes `hasApiKey()` (a boolean), never the key value itself:
 * once the user has typed it in, there is no reason for the renderer to ever
 * read it back — doing so would needlessly extend how long the secret lives
 * in webview memory, undermining the "secure-native" reasoning that put the
 * key in the OS keychain in the first place (architecture.md §11).
 */
export class ManageApiKeyUseCase {
  constructor(private readonly secrets: SecretsPort) {}

  async hasApiKey(): Promise<boolean> {
    const value = await this.secrets.get(SECRET_KEYS.openRouterApiKey);
    return value !== null && value.length > 0;
  }

  setApiKey(value: string): Promise<void> {
    return this.secrets.set(SECRET_KEYS.openRouterApiKey, value);
  }
}
