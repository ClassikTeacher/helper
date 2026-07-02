import { describe, it, expect } from 'vitest';
import { CaptureScreenshotUseCase } from '@/core/application/use-cases/capture-screenshot.use-case';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';
import type { CaptureOptions, ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { Screenshot } from '@/core/domain/screenshot';

describe('CaptureScreenshotUseCase', () => {
  it('returns the screenshot captured by the port', async () => {
    // Arrange
    const useCase = new CaptureScreenshotUseCase(new FakeScreenCaptureAdapter('AAAA'));

    // Act
    const shot = await useCase.execute();

    // Assert
    expect(shot.imageBase64).toBe('AAAA');
    expect(shot.width).toBe(1);
    expect(shot.height).toBe(1);
    expect(typeof shot.capturedAt).toBe('number');
  });

  it('forwards capture options to the port', async () => {
    // Arrange — a spy port that records the options it received.
    let received: CaptureOptions | undefined;
    const spyPort: ScreenCapturePort = {
      async capture(options?: CaptureOptions): Promise<Screenshot> {
        received = options;
        return { imageBase64: 'x', width: 4, height: 2, capturedAt: 0 };
      },
    };
    const useCase = new CaptureScreenshotUseCase(spyPort);

    // Act
    await useCase.execute({ displayIndex: 1, region: { x: 0, y: 0, width: 4, height: 2 } });

    // Assert
    expect(received).toEqual({ displayIndex: 1, region: { x: 0, y: 0, width: 4, height: 2 } });
  });
});
