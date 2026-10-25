import { describe, it, expect, afterEach, vi } from 'vitest';
import { selectLlm } from '@/bootstrap/container';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { OpenRouterLlmAdapter } from '@/infrastructure/llm/openrouter-llm.adapter';
import { TauriLlmAdapter } from '@/infrastructure/tauri/tauri-llm.adapter';

/**
 * The dev-only OpenRouter webview adapter (needs the key in the renderer) must
 * be unreachable outside dev mode — otherwise a production build would carry
 * the `VITE_OPENROUTER_API_KEY` literal (2026-10 review §2.2).
 */
describe('selectLlm', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the secure-native adapter inside Tauri regardless of env', () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'sk-or-v1-dev');
    expect(selectLlm(true)).toBeInstanceOf(TauriLlmAdapter);
  });

  it('uses the dev OpenRouter adapter only in dev mode with a key', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'sk-or-v1-dev');
    expect(selectLlm(false)).toBeInstanceOf(OpenRouterLlmAdapter);

    vi.stubEnv('VITE_OPENROUTER_API_KEY', '');
    expect(selectLlm(false)).toBeInstanceOf(FakeLlmAdapter);
  });

  it('never touches the env key outside dev mode (production build)', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'sk-or-v1-would-leak');
    expect(selectLlm(false)).toBeInstanceOf(FakeLlmAdapter);
  });
});
