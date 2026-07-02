import { ModelRouter } from '@/core/application/services/model-router';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { CaptureScreenshotUseCase } from '@/core/application/use-cases/capture-screenshot.use-case';
import { SendPromptUseCase } from '@/core/application/use-cases/send-prompt.use-case';
import { ManageApiKeyUseCase } from '@/core/application/use-cases/manage-api-key.use-case';

import type { LlmPort } from '@/core/application/ports/llm.port';
import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { OverlayPort } from '@/core/application/ports/overlay.port';
import type { HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { SecretsPort } from '@/core/application/ports/secrets.port';

import { TauriScreenCaptureAdapter } from '@/infrastructure/tauri/tauri-screen-capture.adapter';
import { TauriOverlayAdapter } from '@/infrastructure/tauri/tauri-overlay.adapter';
import { TauriHotkeyAdapter } from '@/infrastructure/tauri/tauri-hotkey.adapter';
import { TauriLlmAdapter } from '@/infrastructure/tauri/tauri-llm.adapter';
import { TauriSecretsAdapter } from '@/infrastructure/tauri/tauri-secrets.adapter';
import { OpenRouterLlmAdapter } from '@/infrastructure/llm/openrouter-llm.adapter';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { InMemorySecretsAdapter } from '@/infrastructure/mocks/in-memory-secrets.adapter';

import type { AppContainer, ContainerOverrides } from './container.types';

/**
 * Composition root — the ONLY place that knows concrete implementations.
 * In a Tauri window it wires native adapters + OpenRouter; in a plain browser
 * (`pnpm dev`) or tests it falls back to fakes. Any dependency can be overridden.
 */
export function createContainer(overrides: ContainerOverrides = {}): AppContainer {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const screenCapture: ScreenCapturePort =
    overrides.screenCapture ?? (isTauri ? new TauriScreenCaptureAdapter() : new FakeScreenCaptureAdapter());

  const llm: LlmPort = overrides.llm ?? selectLlm(isTauri);

  const secrets: SecretsPort =
    overrides.secrets ?? (isTauri ? new TauriSecretsAdapter() : new InMemorySecretsAdapter());

  const modelRouter = overrides.modelRouter ?? new ModelRouter();
  const agentRunner = new AgentRunner({ screenCapture, llm, modelRouter });

  const overlay: OverlayPort = overrides.overlay ?? (isTauri ? new TauriOverlayAdapter() : noopOverlay);
  const hotkey: HotkeyPort = overrides.hotkey ?? (isTauri ? new TauriHotkeyAdapter() : noopHotkey);

  return {
    useCases: {
      analyzeScreenshot: new AnalyzeScreenshotUseCase(agentRunner),
      captureScreenshot: new CaptureScreenshotUseCase(screenCapture),
      sendPrompt: new SendPromptUseCase(llm, modelRouter),
      manageApiKey: new ManageApiKeyUseCase(secrets),
    },
    platform: { overlay, hotkey },
  };
}

/**
 * LLM selection. Production path is SECURE-NATIVE: inside a Tauri window,
 * `TauriLlmAdapter` forwards to the native `llm_stream` command, which reads
 * the key from the OS keychain and streams back over a Tauri Channel — the
 * key never enters the webview. See decisions.md ADR #7.
 *
 * Outside Tauri (`pnpm dev` in a plain browser, or tests), we fall back to the
 * DEV-ONLY OpenRouter webview adapter when a throwaway `VITE_OPENROUTER_API_KEY`
 * is explicitly provided (it exposes the key in the renderer). Otherwise: fakes.
 */
function selectLlm(isTauri: boolean): LlmPort {
  if (isTauri) return new TauriLlmAdapter();
  const devKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (devKey) return new OpenRouterLlmAdapter(devKey);
  return new FakeLlmAdapter();
}

const noopOverlay: OverlayPort = {
  show: async () => {},
  hide: async () => {},
  toggle: async () => {},
  isVisible: async () => false,
};

const noopHotkey: HotkeyPort = {
  register: async () => {},
  unregister: async () => {},
};
