import type { AppContainer } from './container.types';

/**
 * Global accelerator that shows/hides the HUD. Kept as a single named constant
 * (not user-configurable yet) — see tasks.md phase 0.3.
 */
export const TOGGLE_HUD_ACCELERATOR = 'CommandOrControl+Shift+Space';

/**
 * Wires the HUD's global hotkey: pressing the accelerator toggles the overlay
 * window. This is a bootstrap (composition-root) concern — it is the only
 * place that connects `HotkeyPort` to `OverlayPort` (architecture.md §8:
 * `platform` ports are wired by bootstrap, never by UI components).
 *
 * Registration failure (e.g. the accelerator is already taken by another
 * app) is NOT swallowed — it is rethrown so the caller can surface it to the
 * user instead of silently doing nothing (there is no tray/notification yet,
 * so `ServicesProvider` shows the HUD with an error banner as a stopgap).
 */
export async function registerHudHotkey(
  container: Pick<AppContainer, 'platform'>,
): Promise<void> {
  await container.platform.hotkey.register(TOGGLE_HUD_ACCELERATOR, () => {
    void container.platform.overlay.toggle();
  });
}

export async function unregisterHudHotkey(
  container: Pick<AppContainer, 'platform'>,
): Promise<void> {
  await container.platform.hotkey.unregister(TOGGLE_HUD_ACCELERATOR);
}
