import { useHudStore } from '@/ui/store/hud.store';
import { analyzeAndStream } from './analyze-and-stream';
import { resolveAgent } from '@/core/domain/agents-catalog';
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
 * Toggle the HUD's visibility. Delegates to `overlay.toggle()`, which flips
 * based on the window's real OS-level visibility (native is the single source
 * of truth) — no capture, no store bookkeeping.
 */
async function toggleHud(container: HotkeysContainer): Promise<void> {
  await container.platform.overlay.toggle();
}

/**
 * Capture the screen, show it in the HUD, and analyze it — the app's main
 * scenario (plan.md §4: hotkey -> screenshot -> analyze -> stream). The
 * screenshot is taken, pushed into the store, and the HUD is shown before
 * analysis starts (so the user sees the image immediately, with the answer
 * streaming in underneath).
 *
 * The HUD is NOT hidden before capturing: the overlay window is marked
 * content-protected (`contentProtected: true` in tauri.conf.json →
 * `WDA_EXCLUDEFROMCAPTURE` on Windows), so DWM composites it out of every
 * screen-capture frame — including our own `scap` grab, which uses Windows
 * Graphics Capture. The window stays visible to the user but never lands in
 * the shot, which removed the old hide-before / show-after dance (and its
 * flicker). This is the same mechanism that keeps the HUD off screen-shares.
 * (Manual-testing DoD: confirm the HUD is absent from the captured image.)
 *
 * A capture failure is surfaced in the HUD (via `fail`) rather than
 * swallowed, and analysis is skipped entirely in that case — there is
 * nothing to analyze, and `analyzeAndStream` would otherwise overwrite the
 * capture error with its own `startStreaming()` reset. There is no
 * tray/notification channel yet, so the HUD banner is the only feedback path.
 */
async function captureAndAnalyze(container: HotkeysContainer): Promise<void> {
  const { overlay } = container.platform;

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

  // Run whatever agent/language/instructions the user currently has selected in
  // the HUD. The instructions are read at capture time, so anything typed in the
  // input box before the hotkey is taken into account (user's requirement).
  const { agentId, language, instructions } = useHudStore.getState();
  await analyzeAndStream(container.useCases, {
    agent: resolveAgent(agentId),
    language,
    instructions,
    screenshot,
  });
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
