import type { AppContainer } from './container.types';

/**
 * DEV-ONLY convenience: seed the OpenRouter API key from `VITE_OPENROUTER_API_KEY`
 * into the OS keychain on startup, so `pnpm tauri dev` works without manually
 * pasting the key into ⚙ Settings on every fresh machine.
 *
 * Why this exists: the production path is keychain-only (architecture.md §11,
 * decisions.md ADR #7) — both `ManageApiKeyUseCase.hasApiKey()` and the native
 * `llm_stream` command read the key from the OS credential store, and NOTHING
 * reads `VITE_OPENROUTER_API_KEY` inside a Tauri window. That env var is only a
 * dev/browser convenience (see `.env.example`), so without this seed the running
 * app reports "No OpenRouter API key configured" even though the key is in `.env`.
 *
 * Guards:
 * - `import.meta.env.DEV` — never runs in a production build, so the key is
 *   never baked into a release bundle. The keychain-only security model stays
 *   intact for shipped binaries.
 * - only writes when the keychain is empty — a key the user has already entered
 *   via Settings is never overwritten by whatever happens to be in `.env`.
 *
 * Works through `ManageApiKeyUseCase` (not a raw adapter) so it stays a pure
 * bootstrap concern and reuses the same keychain plumbing the UI uses. In the
 * plain-browser dev fallback the use-case is backed by the in-memory secrets
 * adapter, so this is harmless there too.
 *
 * Failures are logged, never thrown: a keychain hiccup must not block app
 * startup — the user can still paste the key manually via Settings.
 */
export async function seedDevApiKey(container: Pick<AppContainer, 'useCases'>): Promise<void> {
  if (!import.meta.env.DEV) return;

  const devKey = import.meta.env.VITE_OPENROUTER_API_KEY?.trim();
  if (!devKey) return;

  const { manageApiKey } = container.useCases;
  try {
    if (await manageApiKey.hasApiKey()) return;
    await manageApiKey.setApiKey(devKey);
  } catch (err) {
    console.error('Failed to seed dev OpenRouter API key from VITE_OPENROUTER_API_KEY', err);
  }
}
