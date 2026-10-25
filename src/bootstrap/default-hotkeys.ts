import type { HotkeySettings } from '@/core/domain/settings';

/**
 * The build's default global hotkeys — what the settings screen starts from
 * (F2). Each slot can be pre-seeded via `VITE_*` (see `.env.example`); the
 * user's own choice in ⚙ → Хоткеи wins over both.
 *
 * Why `Ctrl+Alt+Shift+<key>`: the previous defaults (`Ctrl+Alt+S/L/Enter`,
 * `Ctrl+Shift+Space`) collided with JetBrains and VS Code bindings (2026-10
 * review §4.2). Three-modifier combos on these letters are free in the
 * default keymaps of IntelliJ (Windows), VS Code and Visual Studio; `Shift+S`
 * variants are avoided because screenshot tools claim them.
 */
export const DEFAULT_HOTKEYS: HotkeySettings = {
  /** Show/hide the HUD — a pure visibility toggle, no capture. */
  toggleHud: import.meta.env.VITE_TOGGLE_HUD_ACCELERATOR || 'CommandOrControl+Alt+Shift+H',
  /** Capture the cursor's monitor into the batch (phase 8) — does NOT analyze. */
  capture: import.meta.env.VITE_CAPTURE_ACCELERATOR || 'CommandOrControl+Alt+Shift+K',
  /** Capture the ACTIVE WINDOW into the batch (F5). */
  captureWindow: import.meta.env.VITE_CAPTURE_WINDOW_ACCELERATOR || 'CommandOrControl+Alt+Shift+W',
  /** Send the staged batch (+ agent/language/instructions) and stream the answer. */
  send: import.meta.env.VITE_SEND_ACCELERATOR || 'CommandOrControl+Alt+Shift+Enter',
  /** Toggle loopback audio recording (phase 9); stop = send. */
  record: import.meta.env.VITE_RECORD_ACCELERATOR || 'CommandOrControl+Alt+Shift+R',
  /** Stage the clipboard's text as the code for the next send (R15). */
  pasteCode: import.meta.env.VITE_PASTE_CODE_ACCELERATOR || 'CommandOrControl+Alt+Shift+P',
};
