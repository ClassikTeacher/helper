import type {
  CaptureOptions,
  ScreenCapturePort,
} from '@/core/application/ports/screen-capture.port';
import type { Screenshot } from '@/core/domain/screenshot';

/**
 * Use-case: capture the screen and return it (no LLM). This is the phase-1 seam
 * the hotkey wiring calls through DI to show a screenshot in the HUD.
 *
 * Thin on purpose — a straight pass-through to the port — but it keeps the UI /
 * bootstrap layers depending on an application use-case rather than a port
 * directly, matching AnalyzeScreenshotUseCase.
 */
export class CaptureScreenshotUseCase {
  constructor(private readonly screenCapture: ScreenCapturePort) {}

  execute(options?: CaptureOptions): Promise<Screenshot> {
    return this.screenCapture.capture(options);
  }
}
