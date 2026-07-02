import { useHudStore } from '@/ui/store/hud.store';
import type { AppContainer } from './container.types';

/** The bootstrap slice the hotkey wiring needs: the capture use-case + overlay. */
type HotkeysContainer = Pick<AppContainer, 'platform' | 'useCases'>;

/**
 * Two distinct global hotkeys (phase 1). Overridable via `VITE_*` env vars
 * (see `.env.example`) for easy tuning during early development; not exposed
 * as an in-app setting yet — see tasks.md backlog "Настраиваемый хоткей".
 */
/** Show/hide the HUD — a pure visibility toggle, no capture. */
export const TOGGLE_HUD_ACCELERATOR =
  import.meta.env.VITE_TOGGLE_HUD_ACCELERATOR || 'CommandOrControl+Shift+Space';
/** Capture the screen and show it in the HUD. */
export const SCREENSHOT_ACCELERATOR =
  import.meta.env.VITE_SCREENSHOT_ACCELERATOR || 'CommandOrControl+Shift+S';

/**
 * Toggle the HUD's visibility. Delegates to `overlay.toggle()`, which flips
 * based on the window's real OS-level visibility (native is the single source
 * of truth) — no capture, no store bookkeeping.
 */
async function toggleHud(container: HotkeysContainer): Promise<void> {
  await container.platform.overlay.toggle();
}

/**
 * Capture the screen and show the result in the HUD. The HUD is hidden first if
 * it happens to be visible, so the overlay itself stays out of the shot; then
 * the screenshot is taken, pushed into the store, and the HUD is shown. A
 * capture failure is surfaced in the HUD (via `fail`) rather than swallowed —
 * there is no tray/notification channel yet.
 */
async function captureAndShow(container: HotkeysContainer): Promise<void> {
  const { overlay } = container.platform;

  if (await overlay.isVisible()) {
    await overlay.hide();
  }

  try {
    const shot = await container.useCases.captureScreenshot.execute();
    useHudStore.getState().setScreenshot(shot);
  } catch (err) {
    useHudStore.getState().fail(err instanceof Error ? err.message : String(err));
  }
  await overlay.show();
}

/**
 * Wires the app's global hotkeys. This is a bootstrap (composition-root)
 * concern — the only place that connects `HotkeyPort`, the capture use-case,
 * and `OverlayPort` (architecture.md §8: platform ports are wired by bootstrap,
 * never by UI components).
 *
 * The two hotkeys are registered independently (`allSettled`) so a conflict on
 * one accelerator (e.g. already taken by another app) does not prevent the
 * other from registering. If any registration fails, the aggregated error is
 * rethrown so the caller can surface it (`ServicesProvider` shows the HUD with
 * an error banner as a stopgap) — failures are never swallowed.
 */
export async function registerHotkeys(container: HotkeysContainer): Promise<void> {
  const { hotkey } = container.platform;

  const results = await Promise.allSettled([
    hotkey.register(TOGGLE_HUD_ACCELERATOR, () => {
      void toggleHud(container);
    }),
    hotkey.register(SCREENSHOT_ACCELERATOR, () => {
      void captureAndShow(container);
    }),
  ]);

  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

export async function unregisterHotkeys(
  container: Pick<AppContainer, 'platform'>,
): Promise<void> {
  const { hotkey } = container.platform;
  await Promise.allSettled([
    hotkey.unregister(TOGGLE_HUD_ACCELERATOR),
    hotkey.unregister(SCREENSHOT_ACCELERATOR),
  ]);
}
