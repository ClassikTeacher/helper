import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type { OverlayPort } from '@/core/application/ports/overlay.port';

/**
 * Native adapter for OverlayPort — shows/hides/toggles the HUD window via Rust
 * commands. (Window creation/config lives in tauri.conf.json + the Rust core.)
 *
 * No client-side visibility flag is kept here on purpose: native owns the
 * window and is the single source of truth. `toggle()` delegates to the
 * `overlay_toggle` command, which reads the window's actual OS-level
 * visibility (`window.is_visible()`) before deciding to show or hide —
 * this can't drift out of sync the way a locally-tracked boolean could.
 */
export class TauriOverlayAdapter implements OverlayPort {
  async show(): Promise<void> {
    await invoke<void>(IPC_COMMANDS.overlayShow);
  }

  async hide(): Promise<void> {
    await invoke<void>(IPC_COMMANDS.overlayHide);
  }

  async toggle(): Promise<void> {
    await invoke<void>(IPC_COMMANDS.overlayToggle);
  }

  async isVisible(): Promise<boolean> {
    return invoke<boolean>(IPC_COMMANDS.overlayIsVisible);
  }
}
