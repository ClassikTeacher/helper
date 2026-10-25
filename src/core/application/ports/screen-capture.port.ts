import type { Screenshot } from '@/core/domain/screenshot';

/**
 * What to capture (F5): the monitor under the cursor (default), or the
 * active (foreground) window — the IDE alone, without the second monitor,
 * panels and chat. Native falls back to the monitor when the window cannot be
 * captured (none, minimized, the HUD itself); `Screenshot.source` tells.
 */
export type CaptureTarget = 'cursor-monitor' | 'active-window';

export interface CaptureOptions {
  readonly region?: { x: number; y: number; width: number; height: number };
  readonly displayIndex?: number;
  readonly target?: CaptureTarget;
}

/**
 * Port: capture the screen. Implemented by a native adapter (Tauri/Rust) or a
 * fake. The application layer depends only on this interface.
 */
export interface ScreenCapturePort {
  capture(options?: CaptureOptions): Promise<Screenshot>;
}
