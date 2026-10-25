/**
 * IPC event names (Rust core -> webview) delivered via `@tauri-apps/api/event`.
 *
 * Part of the contract seam; must match `emit(...)` calls in the Rust core.
 */
import type { TrayActionPayloadDto } from './dto';

export const IPC_EVENTS = {
  hotkeyTriggered: 'hotkey://triggered',
  captureProgress: 'capture://progress',
  /**
   * A tray-menu action the webview must carry out (F1): payload
   * `TrayActionPayloadDto` (`{ action: 'stop-recording' }`). Emitted by
   * `src-tauri/src/tray.rs`.
   */
  trayAction: 'tray://action',
} as const;

export type IpcEventName = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

/** Payload for `hotkey://triggered`. */
export interface HotkeyTriggeredPayload {
  /** Logical action bound to the pressed accelerator, e.g. "analyze-screen". */
  readonly action: string;
}

/** Payload for `capture://progress`. */
export interface CaptureProgressPayload {
  readonly stage: 'capturing' | 'encoding' | 'done';
}

/** Payload for `tray://action`. */
export type TrayActionPayload = TrayActionPayloadDto;
