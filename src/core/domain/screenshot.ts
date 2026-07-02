/**
 * Domain entity: a captured screenshot. Pure data — no I/O, no framework.
 */
export interface Screenshot {
  readonly imageBase64: string;
  readonly width: number;
  readonly height: number;
  /** Unix epoch milliseconds, UTC. */
  readonly capturedAt: number;
}

export function screenshotDataUrl(shot: Screenshot): string {
  return `data:image/png;base64,${shot.imageBase64}`;
}
