import type { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import type { CaptureScreenshotUseCase } from '@/core/application/use-cases/capture-screenshot.use-case';
import type { SendPromptUseCase } from '@/core/application/use-cases/send-prompt.use-case';
import type { ManageApiKeyUseCase } from '@/core/application/use-cases/manage-api-key.use-case';
import type { TranscribeAudioUseCase } from '@/core/application/use-cases/transcribe-audio.use-case';
import type { GetDiagnosticsUseCase } from '@/core/application/use-cases/get-diagnostics.use-case';
import type { AudioTranscriptionPort } from '@/core/application/ports/audio-transcription.port';
import type { DiagnosticsPort } from '@/core/application/ports/diagnostics.port';
import type { OverlayPort } from '@/core/application/ports/overlay.port';
import type { ClipboardPort } from '@/core/application/ports/clipboard.port';
import type { HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { LlmPort } from '@/core/application/ports/llm.port';
import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { SecretsPort } from '@/core/application/ports/secrets.port';

/**
 * The DI container. UI consumes ONLY `useCases` (via useServices). `platform`
 * ports (overlay/hotkey/clipboard) are wired by the bootstrap layer, not by
 * components. There is no persistence slice: nothing is written to disk.
 */
export interface AppContainer {
  readonly useCases: {
    readonly analyzeScreenshot: AnalyzeScreenshotUseCase;
    readonly captureScreenshot: CaptureScreenshotUseCase;
    readonly sendPrompt: SendPromptUseCase;
    readonly manageApiKey: ManageApiKeyUseCase;
    /** Loopback recording + cloud STT (phase 9). */
    readonly transcribeAudio: TranscribeAudioUseCase;
    /** Bug-report text: version, platform, native log tail (⚙ → Copy diagnostics). */
    readonly getDiagnostics: GetDiagnosticsUseCase;
  };
  readonly platform: {
    readonly overlay: OverlayPort;
    readonly hotkey: HotkeyPort;
    /** Clipboard text for the paste-code hotkey (R15). */
    readonly clipboard: ClipboardPort;
  };
}

/** Overrides let tests/dev swap any dependency (see createContainer). */
export interface ContainerOverrides {
  readonly llm?: LlmPort;
  readonly screenCapture?: ScreenCapturePort;
  readonly overlay?: OverlayPort;
  readonly hotkey?: HotkeyPort;
  readonly secrets?: SecretsPort;
  readonly audio?: AudioTranscriptionPort;
  readonly clipboard?: ClipboardPort;
  readonly diagnostics?: DiagnosticsPort;
}
