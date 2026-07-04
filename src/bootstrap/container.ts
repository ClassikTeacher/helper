import { ResilientLlm } from '@/core/application/services/resilient-llm';
import { buildModelChain } from './model-chain';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { CaptureScreenshotUseCase } from '@/core/application/use-cases/capture-screenshot.use-case';
import { SendPromptUseCase } from '@/core/application/use-cases/send-prompt.use-case';
import { ManageApiKeyUseCase } from '@/core/application/use-cases/manage-api-key.use-case';
import { RecordConversationUseCase } from '@/core/application/use-cases/record-conversation.use-case';

import type { LlmPort } from '@/core/application/ports/llm.port';
import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { OverlayPort } from '@/core/application/ports/overlay.port';
import type { HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { SecretsPort } from '@/core/application/ports/secrets.port';
import type { StoragePort } from '@/core/application/ports/storage.port';
import type { ConversationRepository } from '@/core/application/ports/conversation.repository';

import { TauriScreenCaptureAdapter } from '@/infrastructure/tauri/tauri-screen-capture.adapter';
import { TauriOverlayAdapter } from '@/infrastructure/tauri/tauri-overlay.adapter';
import { TauriHotkeyAdapter } from '@/infrastructure/tauri/tauri-hotkey.adapter';
import { TauriLlmAdapter } from '@/infrastructure/tauri/tauri-llm.adapter';
import { TauriSecretsAdapter } from '@/infrastructure/tauri/tauri-secrets.adapter';
import { OpenRouterLlmAdapter } from '@/infrastructure/llm/openrouter-llm.adapter';
import { TauriStorageAdapter } from '@/infrastructure/persistence/tauri-storage.adapter';
import { SqliteConversationRepository } from '@/infrastructure/persistence/sqlite-conversation.repository';
import { applyMigrations } from '@/infrastructure/persistence/migrations';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { InMemorySecretsAdapter } from '@/infrastructure/mocks/in-memory-secrets.adapter';
import { InMemoryConversationRepository } from '@/infrastructure/mocks/in-memory-conversation.repository';

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

  // Wrap the base LLM adapter in the resilient failover layer so a provider
  // outage / unavailable model transparently falls over to the next model in
  // the chain (see ResilientLlm). An explicit `llm` override bypasses failover
  // (tests inject exactly the adapter they want).
  const llm: LlmPort = overrides.llm ?? new ResilientLlm(selectLlm(isTauri), buildModelChain());

  const secrets: SecretsPort =
    overrides.secrets ?? (isTauri ? new TauriSecretsAdapter() : new InMemorySecretsAdapter());

  const agentRunner = new AgentRunner({ screenCapture, llm });

  // Persistence (phase 4). In a Tauri window the repositories run on real SQLite
  // via tauri-plugin-sql; in a browser/tests they fall back to in-memory stores
  // (no migrations needed there). `storage` is shared by both repositories so
  // the whole app uses one connection pool.
  const storage: StoragePort | null =
    overrides.storage ?? (isTauri ? new TauriStorageAdapter() : null);

  const conversations: ConversationRepository =
    overrides.conversationRepository ??
    (storage ? new SqliteConversationRepository(storage) : new InMemoryConversationRepository());

  // NB: agents (phase 5) are a fixed built-in catalog (`core/domain/agents-catalog.ts`),
  // not persisted/editable, so there is no AgentRepository to wire — the UI
  // selects between solver/reviewer and the runner builds the prompt (YAGNI).

  const overlay: OverlayPort = overrides.overlay ?? (isTauri ? new TauriOverlayAdapter() : noopOverlay);
  const hotkey: HotkeyPort = overrides.hotkey ?? (isTauri ? new TauriHotkeyAdapter() : noopHotkey);

  return {
    useCases: {
      analyzeScreenshot: new AnalyzeScreenshotUseCase(agentRunner),
      captureScreenshot: new CaptureScreenshotUseCase(screenCapture),
      sendPrompt: new SendPromptUseCase(llm),
      manageApiKey: new ManageApiKeyUseCase(secrets),
      recordConversation: new RecordConversationUseCase(conversations),
    },
    platform: { overlay, hotkey },
    persistence: {
      // Only the real SQLite path needs migrations; in-memory repos have no
      // schema. Runs on startup (see main.tsx).
      applyMigrations: storage ? () => applyMigrations(storage) : async () => {},
    },
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
