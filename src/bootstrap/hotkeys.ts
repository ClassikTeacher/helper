import { useHudStore, MAX_SCREENSHOTS } from '@/ui/store/hud.store';
import { analyzeAndStream } from './analyze-and-stream';
import { resolveAgent } from '@/core/domain/agents-catalog';
import type { AppContainer } from './container.types';

/** The bootstrap slice the hotkey wiring needs: the capture use-case + overlay. */
type HotkeysContainer = Pick<AppContainer, 'platform' | 'useCases'>;

/**
 * Three distinct global hotkeys. Overridable via `VITE_*` env vars
 * (see `.env.example`) for easy tuning during early development; not exposed
 * as an in-app setting yet — see tasks.md backlog "Настраиваемый хоткей".
 */
/** Show/hide the HUD — a pure visibility toggle, no capture. */
export const TOGGLE_HUD_ACCELERATOR =
  import.meta.env.VITE_TOGGLE_HUD_ACCELERATOR || 'CommandOrControl+Shift+Space';
/**
 * Capture the screen and ADD it to the batch (phase 8) — does NOT analyze.
 * The user stages 1–`MAX_SCREENSHOTS` shots this way, then fires
 * `SEND_ACCELERATOR` to analyze them together. Default is `Ctrl+Alt+S` rather
 * than the more obvious `Ctrl+Shift+S` because the latter is very commonly
 * claimed globally by screenshot tools (ShareX, Lightshot, Snip utilities,
 * vendor overlays), which makes registration fail with "HotKey already
 * registered". Override via `VITE_CAPTURE_ACCELERATOR`.
 */
export const CAPTURE_ACCELERATOR =
  import.meta.env.VITE_CAPTURE_ACCELERATOR || 'CommandOrControl+Alt+S';
/**
 * Send the staged screenshot batch (+ the current agent/language/instructions)
 * for analysis and stream the answer (phase 8). Override via
 * `VITE_SEND_ACCELERATOR`.
 */
export const SEND_ACCELERATOR =
  import.meta.env.VITE_SEND_ACCELERATOR || 'CommandOrControl+Alt+Enter';

/**
 * Toggle the HUD's visibility. Delegates to `overlay.toggle()`, which flips
 * based on the window's real OS-level visibility (native is the single source
 * of truth) — no capture, no store bookkeeping.
 */
async function toggleHud(container: HotkeysContainer): Promise<void> {
  await container.platform.overlay.toggle();
}

/**
 * Capture the screen and stage it in the HUD's screenshot batch (phase 8).
 * Does NOT analyze — analysis is deferred to `sendBuffer` (SEND_ACCELERATOR),
 * so the user can stack several shots first. The HUD is shown so the user sees
 * the growing batch.
 *
 * The HUD is NOT hidden before capturing: the overlay window is marked
 * content-protected (`contentProtected: true` in tauri.conf.json →
 * `WDA_EXCLUDEFROMCAPTURE` on Windows), so DWM composites it out of every
 * screen-capture frame — including our own `scap` grab. The window stays
 * visible to the user but never lands in the shot.
 *
 * At `MAX_SCREENSHOTS` we skip the capture entirely (the store would ignore it
 * anyway) to avoid a wasted grab; the "N/MAX" counter tells the user the batch
 * is full. A capture failure is surfaced in the HUD (via `fail`) rather than
 * swallowed. There is no tray/notification channel yet, so the HUD banner is
 * the only feedback path.
 */
async function captureToBuffer(container: HotkeysContainer): Promise<void> {
  const { overlay } = container.platform;

  if (useHudStore.getState().screenshots.length >= MAX_SCREENSHOTS) {
    await overlay.show();
    return;
  }

  try {
    const screenshot = await container.useCases.captureScreenshot.execute();
    useHudStore.getState().addScreenshot(screenshot);
  } catch (err) {
    useHudStore.getState().fail(err instanceof Error ? err.message : String(err));
  }
  await overlay.show();
}

/**
 * Send the staged screenshot batch for analysis — the app's main scenario
 * (plan.md §4: hotkey -> screenshots -> analyze -> stream), now decoupled from
 * capture (phase 8). Runs whatever agent/language/instructions the user
 * currently has selected in the HUD (read at send time). If the batch is empty,
 * surfaces a clear error instead of silently capturing — the user is expected
 * to stage at least one shot first with `CAPTURE_ACCELERATOR`.
 */
async function sendBuffer(container: HotkeysContainer): Promise<void> {
  const { overlay } = container.platform;
  await overlay.show();

  const { screenshots, agentId, language, instructions } = useHudStore.getState();
  if (screenshots.length === 0) {
    useHudStore
      .getState()
      .fail('Нет скриншотов для анализа — сделайте хотя бы один (хоткей захвата).');
    return;
  }

  await analyzeAndStream(container.useCases, {
    agent: resolveAgent(agentId),
    language,
    instructions,
    screenshots,
  });
}

/**
 * Wires the app's global hotkeys. This is a bootstrap (composition-root)
 * concern — the only place that connects `HotkeyPort`, the capture use-case,
 * and `OverlayPort` (architecture.md §8: platform ports are wired by bootstrap,
 * never by UI components).
 *
 * The three hotkeys are registered independently (`allSettled`) so a conflict
 * on one accelerator (e.g. already taken by another app) does not prevent the
 * others from registering. If any registration fails, the aggregated error is
 * rethrown so the caller can surface it (`ServicesProvider` shows the HUD with
 * an error banner as a stopgap) — failures are never swallowed.
 */
export async function registerHotkeys(container: HotkeysContainer): Promise<void> {
  const { hotkey } = container.platform;

  const results = await Promise.allSettled([
    hotkey.register(TOGGLE_HUD_ACCELERATOR, () => {
      void toggleHud(container);
    }),
    hotkey.register(CAPTURE_ACCELERATOR, () => {
      void captureToBuffer(container);
    }),
    hotkey.register(SEND_ACCELERATOR, () => {
      void sendBuffer(container);
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
    hotkey.unregister(CAPTURE_ACCELERATOR),
    hotkey.unregister(SEND_ACCELERATOR),
  ]);
}
