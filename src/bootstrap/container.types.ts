import type { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import type { CaptureScreenshotUseCase } from '@/core/application/use-cases/capture-screenshot.use-case';
import type { SendPromptUseCase } from '@/core/application/use-cases/send-prompt.use-case';
import type { ManageApiKeyUseCase } from '@/core/application/use-cases/manage-api-key.use-case';
import type { OverlayPort } from '@/core/application/ports/overlay.port';
import type { HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { LlmPort } from '@/core/application/ports/llm.port';
import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { SecretsPort } from '@/core/application/ports/secrets.port';
import type { ModelRouter } from '@/core/application/services/model-router';

/**
 * The DI container. UI consumes ONLY `useCases` (via useServices). `platform`
 * ports (overlay/hotkey) are wired by the bootstrap layer, not by components.
 */
export interface AppContainer {
  readonly useCases: {
    readonly analyzeScreenshot: AnalyzeScreenshotUseCase;
    readonly captureScreenshot: CaptureScreenshotUseCase;
    readonly sendPrompt: SendPromptUseCase;
    readonly manageApiKey: ManageApiKeyUseCase;
  };
  readonly platform: {
    readonly overlay: OverlayPort;
    readonly hotkey: HotkeyPort;
  };
}

/** Overrides let tests/dev swap any dependency (see createContainer). */
export interface ContainerOverrides {
  readonly llm?: LlmPort;
  readonly screenCapture?: ScreenCapturePort;
  readonly overlay?: OverlayPort;
  readonly hotkey?: HotkeyPort;
  readonly secrets?: SecretsPort;
  readonly modelRouter?: ModelRouter;
}
