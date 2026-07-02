import type { Screenshot } from '@/core/domain/screenshot';

export interface CaptureOptions {
  readonly region?: { x: number; y: number; width: number; height: number };
  readonly displayIndex?: number;
}

/**
 * Port: capture the screen. Implemented by a native adapter (Tauri/Rust) or a
 * fake. The application layer depends only on this interface.
 */
export interface ScreenCapturePort {
  capture(options?: CaptureOptions): Promise<Screenshot>;
}
