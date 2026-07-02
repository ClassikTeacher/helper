import type { AnalyzeScreenshotUseCase } from '@/core/application/use-cases/analyze-screenshot.use-case';
import type { SendPromptUseCase } from '@/core/application/use-cases/send-prompt.use-case';
import type { OverlayPort } from '@/core/application/ports/overlay.port';
import type { HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { LlmPort } from '@/core/application/ports/llm.port';
import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { ModelRouter } from '@/core/application/services/model-router';

/**
 * The DI container. UI consumes ONLY `useCases` (via useServices). `platform`
 * ports (overlay/hotkey) are wired by the bootstrap layer, not by components.
 */
export interface AppContainer {
  readonly useCases: {
    readonly analyzeScreenshot: AnalyzeScreenshotUseCase;
    readonly sendPrompt: SendPromptUseCase;
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
  readonly modelRouter?: ModelRouter;
}
