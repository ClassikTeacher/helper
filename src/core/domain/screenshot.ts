/**
 * Domain entity: a captured screenshot. Pure data — no I/O, no framework.
 */
/** Where a screenshot came from: a whole monitor or one window (F5). */
export type ScreenshotSource = 'monitor' | 'window';

export interface Screenshot {
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
  /** Unix epoch milliseconds, UTC. */
  readonly capturedAt: number;
  /** Absent for legacy/fake sources = a monitor. */
  readonly source?: ScreenshotSource;
}

export function screenshotDataUrl(shot: Screenshot): string {
  return `data:image/png;base64,${shot.imageBase64}`;
}
