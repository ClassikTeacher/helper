import { ResilientLlm } from '@/core/application/services/resilient-llm';
import { buildTranscriberConfig } from './model-chain';
import { ScreenTranscriber, type ScreenReader } from '@/core/application/services/screen-transcriber';
import { LocalScreenReader } from '@/core/application/services/local-screen-reader';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import { CaptureScreenshotUseCase } from '@/core/application/use-cases/capture-screenshot.use-case';
import { SendPromptUseCase } from '@/core/application/use-cases/send-prompt.use-case';
import { ManageApiKeyUseCase } from '@/core/application/use-cases/manage-api-key.use-case';
import { TranscribeAudioUseCase } from '@/core/application/use-cases/transcribe-audio.use-case';
import { GetDiagnosticsUseCase } from '@/core/application/use-cases/get-diagnostics.use-case';
import { ManageSettingsUseCase } from '@/core/application/use-cases/manage-settings.use-case';
import { buildDefaultSettings } from './default-settings';
import { toRouteProfiles, type AppSettings } from '@/core/domain/settings';
import { isTauriWindow } from './platform';

import type { LlmPort } from '@/core/application/ports/llm.port';
import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { OverlayPort } from '@/core/application/ports/overlay.port';
import type { HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { ClipboardPort } from '@/core/application/ports/clipboard.port';
import type { SecretsPort } from '@/core/application/ports/secrets.port';
import type { AudioTranscriptionPort } from '@/core/application/ports/audio-transcription.port';
import type { OcrPort } from '@/core/application/ports/ocr.port';
import type { DiagnosticsPort } from '@/core/application/ports/diagnostics.port';
import type { TrayPort } from '@/core/application/ports/tray.port';
import type { SettingsPort } from '@/core/application/ports/settings.port';

import { TauriScreenCaptureAdapter } from '@/infrastructure/tauri/tauri-screen-capture.adapter';
import { TauriOverlayAdapter } from '@/infrastructure/tauri/tauri-overlay.adapter';
import { TauriHotkeyAdapter } from '@/infrastructure/tauri/tauri-hotkey.adapter';
import { TauriLlmAdapter } from '@/infrastructure/tauri/tauri-llm.adapter';
import { TauriSecretsAdapter } from '@/infrastructure/tauri/tauri-secrets.adapter';
import { TauriAudioAdapter } from '@/infrastructure/tauri/tauri-audio.adapter';
import { TauriClipboardAdapter } from '@/infrastructure/tauri/tauri-clipboard.adapter';
import { TauriOcrAdapter } from '@/infrastructure/tauri/tauri-ocr.adapter';
import { TauriDiagnosticsAdapter } from '@/infrastructure/tauri/tauri-diagnostics.adapter';
import { TauriTrayAdapter } from '@/infrastructure/tauri/tauri-tray.adapter';
import { TauriStoreSettingsAdapter } from '@/infrastructure/tauri/tauri-store-settings.adapter';
import { InMemorySettingsAdapter } from '@/infrastructure/mocks/in-memory-settings.adapter';
import { OpenRouterLlmAdapter } from '@/infrastructure/llm/openrouter-llm.adapter';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import { InMemorySecretsAdapter } from '@/infrastructure/mocks/in-memory-secrets.adapter';
import { FakeAudioAdapter } from '@/infrastructure/mocks/fake-audio.adapter';
import { FakeOcrAdapter } from '@/infrastructure/mocks/fake-ocr.adapter';
import { FakeDiagnosticsAdapter } from '@/infrastructure/mocks/fake-diagnostics.adapter';

import type { AppContainer, ContainerOverrides } from './container.types';

/**
 * Composition root — the ONLY place that knows concrete implementations.
 * In a Tauri window it wires native adapters + OpenRouter; in a plain browser
 * (`pnpm dev`) or tests it falls back to fakes. Any dependency can be overridden.
 *
 * Nothing here persists to disk: dialogs live in memory for the lifetime of
 * the process (hud.store). The SQLite history of phase 4a was removed in the
 * 2026-10 review (§2.4) — it stored other people's screen content in plain
 * text with no reader, no retention and no viewer.
 */
export function createContainer(overrides: ContainerOverrides = {}): AppContainer {
  const isTauri = isTauriWindow();

  // Settings (F2): defaults from `VITE_*`, the user's patch from the store
  // file. Consumers read them through `current()` at call time, so a save in
  // ⚙ applies to the next request without rebuilding anything.
  const settingsPort: SettingsPort =
    overrides.settings ?? (isTauri ? new TauriStoreSettingsAdapter() : new InMemorySettingsAdapter());
  const manageSettings = new ManageSettingsUseCase(settingsPort, overrides.defaultSettings ?? buildDefaultSettings());
  const current = (): AppSettings => manageSettings.settings;

  const screenCapture: ScreenCapturePort =
    overrides.screenCapture ?? (isTauri ? new TauriScreenCaptureAdapter() : new FakeScreenCaptureAdapter());

  // Wrap the base LLM adapter in the resilient failover layer so a provider
  // outage / unavailable model transparently falls over to the next model in
  // the chain (see ResilientLlm). An explicit `llm` override bypasses failover
  // (tests inject exactly the adapter they want). Routes are read live from
  // the settings.
  const llm: LlmPort =
    overrides.llm ?? new ResilientLlm(selectLlm(isTauri, current), () => toRouteProfiles(current().routes));

  const secrets: SecretsPort =
    overrides.secrets ?? (isTauri ? new TauriSecretsAdapter() : new InMemorySecretsAdapter());

  // Loopback recording + cloud STT (phase 9). Native in a Tauri window; a fake
  // (no-op recorder, empty transcript) in a browser/tests.
  const audio: AudioTranscriptionPort =
    overrides.audio ??
    (isTauri
      ? new TauriAudioAdapter({ recording: () => current().recording, stt: () => current().stt })
      : new FakeAudioAdapter());

  // Optional screenshot → text pass, off unless VITE_AUTO_TRANSCRIBE: the
  // on-device OCR (phase 6, default) or a cloud model call (P1 item 7).
  const transcriberConfig = buildTranscriberConfig();
  let transcriber: ScreenReader | undefined;
  if (transcriberConfig?.engine === 'local') {
    const ocr: OcrPort = overrides.ocr ?? (isTauri ? new TauriOcrAdapter() : new FakeOcrAdapter());
    transcriber = new LocalScreenReader(ocr, transcriberConfig.agents);
  } else if (transcriberConfig) {
    transcriber = new ScreenTranscriber(llm, transcriberConfig);
  }
  const agentRunner = new AgentRunner({ screenCapture, llm, ...(transcriber ? { transcriber } : {}) });

  // NB: agents (phase 5) are a fixed built-in catalog (`core/domain/agents-catalog.ts`),
  // not persisted/editable, so there is no AgentRepository to wire — the UI
  // selects between solver/reviewer and the runner builds the prompt (YAGNI).

  const overlay: OverlayPort = overrides.overlay ?? (isTauri ? new TauriOverlayAdapter() : noopOverlay);
  const hotkey: HotkeyPort = overrides.hotkey ?? (isTauri ? new TauriHotkeyAdapter() : noopHotkey);
  const clipboard: ClipboardPort =
    overrides.clipboard ?? (isTauri ? new TauriClipboardAdapter() : browserClipboard);
  // F1: the native tray forwards "stop recording"; a browser has no tray.
  const tray: TrayPort = overrides.tray ?? (isTauri ? new TauriTrayAdapter() : noopTray);
  // Bug-report snapshot (2026-10 review §5.5): the native log tail in Tauri, a
  // fixed stub in the browser.
  const diagnostics: DiagnosticsPort =
    overrides.diagnostics ?? (isTauri ? new TauriDiagnosticsAdapter() : new FakeDiagnosticsAdapter());

  return {
    useCases: {
      analyzeScreenshot: new AnalyzeScreenshotUseCase(agentRunner),
      captureScreenshot: new CaptureScreenshotUseCase(screenCapture),
      sendPrompt: new SendPromptUseCase(llm),
      manageApiKey: new ManageApiKeyUseCase(secrets),
      transcribeAudio: new TranscribeAudioUseCase(audio),
      getDiagnostics: new GetDiagnosticsUseCase(diagnostics),
      manageSettings,
    },
    platform: { overlay, hotkey, clipboard, tray },
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
 *
 * The dev branch is gated on `import.meta.env.DEV`, not only on the Tauri
 * check: Vite inlines `VITE_*` values as string literals at build time, so an
 * ungated reference would bake whatever key sits in `.env` on the build
 * machine into the shipped bundle — even though the Tauri path never reads it
 * (2026-10 review §2.2). With the gate the whole branch is dead code in a
 * production build and is dropped; `vite.config.ts` additionally defines the
 * variable away on `vite build`. Exported for that regression test only.
 */
export function selectLlm(isTauri: boolean, settings?: () => AppSettings): LlmPort {
  if (isTauri) return new TauriLlmAdapter(settings ? { provider: () => settings().provider } : {});
  if (import.meta.env.DEV) {
    const devKey = import.meta.env.VITE_OPENROUTER_API_KEY;
    if (devKey) return new OpenRouterLlmAdapter(devKey);
  }
  return new FakeLlmAdapter();
}

const noopOverlay: OverlayPort = {
  show: async () => {},
  hide: async () => {},
  toggle: async () => {},
  isVisible: async () => false,
};

/** Browser (`pnpm dev`) clipboard: the web API, empty when denied/unavailable. */
const browserClipboard: ClipboardPort = {
  readText: async () => {
    try {
      return (await navigator.clipboard?.readText()) ?? '';
    } catch {
      return '';
    }
  },
};

const noopHotkey: HotkeyPort = {
  register: async () => {},
  unregister: async () => {},
};

const noopTray: TrayPort = {
  onAction: async () => () => {},
};
