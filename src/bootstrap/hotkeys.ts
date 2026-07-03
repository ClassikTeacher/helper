import { useHudStore } from '@/ui/store/hud.store';
import { analyzeAndStream } from './analyze-and-stream';
import type { AppContainer } from './container.types';
import type { Screenshot } from '@/core/domain/screenshot';

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
/**
 * Capture the screen, show it in the HUD, and analyze it (main scenario).
 * Default is `Ctrl+Alt+S` rather than the more obvious `Ctrl+Shift+S` because
 * the latter is very commonly claimed globally by screenshot tools (ShareX,
 * Lightshot, Snip utilities, vendor overlays), which makes registration fail
 * with "HotKey already registered". Override via `VITE_SCREENSHOT_ACCELERATOR`.
 */
export const SCREENSHOT_ACCELERATOR =
  import.meta.env.VITE_SCREENSHOT_ACCELERATOR || 'CommandOrControl+Alt+S';

/**
 * Sent to the model when the user triggers analysis via the hotkey rather
 * than typing a specific question — the main scenario (plan.md: "хоткей →
 * скриншот → анализ → стриминг") doesn't require the user to phrase anything.
 * Follow-up questions about the same screenshot go through `PromptInput`.
 */
const DEFAULT_SCREEN_PROMPT =
  'Describe what is on this screen and answer any question visible on it. Be concise.';

/**
 * Toggle the HUD's visibility. Delegates to `overlay.toggle()`, which flips
 * based on the window's real OS-level visibility (native is the single source
 * of truth) — no capture, no store bookkeeping.
 */
async function toggleHud(container: HotkeysContainer): Promise<void> {
  await container.platform.overlay.toggle();
}

/**
 * Capture the screen, show it in the HUD, and analyze it — the app's main
 * scenario (plan.md §4: hotkey -> screenshot -> analyze -> stream). The HUD
 * is hidden first if it happens to be visible, so the overlay itself stays
 * out of the shot; then the screenshot is taken, pushed into the store, and
 * the HUD is shown before analysis starts (so the user sees the image
 * immediately, with the answer streaming in underneath).
 *
 * A capture failure is surfaced in the HUD (via `fail`) rather than
 * swallowed, and analysis is skipped entirely in that case — there is
 * nothing to analyze, and `analyzeAndStream` would otherwise overwrite the
 * capture error with its own `startStreaming()` reset. There is no
 * tray/notification channel yet, so the HUD banner is the only feedback path.
 */
async function captureAndAnalyze(container: HotkeysContainer): Promise<void> {
  const { overlay } = container.platform;

  if (await overlay.isVisible()) {
    await overlay.hide();
  }

  let screenshot: Screenshot;
  try {
    screenshot = await container.useCases.captureScreenshot.execute();
  } catch (err) {
    useHudStore.getState().fail(err instanceof Error ? err.message : String(err));
    await overlay.show();
    return;
  }

  useHudStore.getState().setScreenshot(screenshot);
  await overlay.show();

  await analyzeAndStream(container.useCases, { prompt: DEFAULT_SCREEN_PROMPT, screenshot });
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
      void captureAndAnalyze(container);
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
