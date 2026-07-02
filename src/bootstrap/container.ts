import { ModelRouter } from '@/core/application/services/model-router';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { SendPromptUseCase } from '@/core/application/use-cases/send-prompt.use-case';

import type { LlmPort } from '@/core/application/ports/llm.port';
import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { OverlayPort } from '@/core/application/ports/overlay.port';
import type { HotkeyPort } from '@/core/application/ports/hotkey.port';

import { TauriScreenCaptureAdapter } from '@/infrastructure/tauri/tauri-screen-capture.adapter';
import { TauriOverlayAdapter } from '@/infrastructure/tauri/tauri-overlay.adapter';
import { TauriHotkeyAdapter } from '@/infrastructure/tauri/tauri-hotkey.adapter';
import { OpenRouterLlmAdapter } from '@/infrastructure/llm/openrouter-llm.adapter';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';

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

  const llm: LlmPort = overrides.llm ?? selectLlm();

  const modelRouter = overrides.modelRouter ?? new ModelRouter();
  const agentRunner = new AgentRunner({ screenCapture, llm, modelRouter });

  const overlay: OverlayPort = overrides.overlay ?? (isTauri ? new TauriOverlayAdapter() : noopOverlay);
  const hotkey: HotkeyPort = overrides.hotkey ?? (isTauri ? new TauriHotkeyAdapter() : noopHotkey);

  return {
    useCases: {
      analyzeScreenshot: new AnalyzeScreenshotUseCase(agentRunner),
      sendPrompt: new SendPromptUseCase(llm, modelRouter),
    },
    platform: { overlay, hotkey },
  };
}

/**
 * LLM selection. Production path is SECURE-NATIVE: the native `llm_stream`
 * command reads the key from the OS keychain and streams back over a Tauri
 * Channel, bridged by `TauriLlmAdapter` (phase 2) — the key never enters the
 * webview. See decisions.md ADR #7.
 *
 * Until that native path lands, we only use the DEV-ONLY OpenRouter webview
 * adapter when a throwaway `VITE_OPENROUTER_API_KEY` is explicitly provided
 * (it exposes the key in the renderer). Otherwise: fakes.
 */
function selectLlm(): LlmPort {
  // TODO(phase 2): `return new TauriLlmAdapter()` when isTauri — native streaming.
  const devKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (devKey) return new OpenRouterLlmAdapter(devKey);
  return new FakeLlmAdapter();
}

const noopOverlay: OverlayPort = {
  show: async () => {},
  hide: async () => {},
  toggle: async () => {},
};

const noopHotkey: HotkeyPort = {
  register: async () => {},
  unregister: async () => {},
};
