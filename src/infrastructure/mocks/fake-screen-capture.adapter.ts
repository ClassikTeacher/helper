import type { CaptureOptions, ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { Screenshot } from '@/core/domain/screenshot';

// 1x1 transparent PNG.
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * ScreenCapturePort for dev/tests — returns a fixed tiny image, no native calls.
 */
export class FakeScreenCaptureAdapter implements ScreenCapturePort {
  constructor(private readonly imageBase64 = TINY_PNG) {}

  async capture(_options?: CaptureOptions): Promise<Screenshot> {
    return { imageBase64: this.imageBase64, width: 1, height: 1, capturedAt: Date.now() };
  }
}
