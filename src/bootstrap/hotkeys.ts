import { useHudStore, MAX_SCREENSHOTS } from '@/ui/store/hud.store';
import { sendBatch } from './send-batch';
import { toggleRecording } from './toggle-recording';
import { DEFAULT_HOTKEYS } from './default-hotkeys';
import type { CaptureTarget } from '@/core/application/ports/screen-capture.port';
import type { HotkeySettings } from '@/core/domain/settings';
import type { AppContainer } from './container.types';

/** The bootstrap slice the hotkey wiring needs: the capture use-case + overlay. */
type HotkeysContainer = Pick<AppContainer, 'platform' | 'useCases'>;

/**
 * The six global hotkeys. Their bindings come from the settings (F2) — the
 * build's defaults live in `default-hotkeys.ts` and are re-exported here as
 * named constants for callers/tests that want the defaults.
 */
export const TOGGLE_HUD_ACCELERATOR = DEFAULT_HOTKEYS.toggleHud;
export const CAPTURE_ACCELERATOR = DEFAULT_HOTKEYS.capture;
export const CAPTURE_WINDOW_ACCELERATOR = DEFAULT_HOTKEYS.captureWindow;
export const SEND_ACCELERATOR = DEFAULT_HOTKEYS.send;
export const RECORD_ACCELERATOR = DEFAULT_HOTKEYS.record;
export const PASTE_CODE_ACCELERATOR = DEFAULT_HOTKEYS.pasteCode;

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
async function captureToBuffer(
  container: HotkeysContainer,
  target: CaptureTarget = 'cursor-monitor',
): Promise<void> {
  const { overlay } = container.platform;

  if (useHudStore.getState().screenshots.length >= MAX_SCREENSHOTS) {
    await overlay.show();
    return;
  }

  try {
    const screenshot = await container.useCases.captureScreenshot.execute({ target });
    useHudStore.getState().addScreenshot(screenshot);
    // Native could not capture the window (none, minimized, the HUD itself)
    // and took the monitor instead: the shot is staged, but say so.
    if (target === 'active-window' && screenshot.source !== 'window') {
      useHudStore.getState().setNotice(WINDOW_FALLBACK_NOTICE);
    }
  } catch (err) {
    useHudStore.getState().fail(err instanceof Error ? err.message : String(err));
  }
  await overlay.show();
}

export const WINDOW_FALLBACK_NOTICE =
  'Активное окно недоступно для захвата — снят монитор под курсором.';

/**
 * Read the clipboard into the staged code text (R15) and show the HUD. An
 * empty/non-text clipboard is reported in the HUD instead of silently staging
 * nothing.
 */
async function pasteCodeFromClipboard(container: HotkeysContainer): Promise<void> {
  const text = await container.platform.clipboard.readText();
  if (text.trim()) {
    useHudStore.getState().setCodeText(text);
  } else {
    // `setError`, not `fail`: the hotkey may fire during a recording or a
    // streaming answer, and must not flip their indicators off.
    useHudStore.getState().setError('Буфер обмена не содержит текста — скопируйте код и повторите.');
  }
  await container.platform.overlay.show();
}

/**
 * Toggle loopback audio recording (phase 9) and show the HUD. The toggle logic
 * is shared with the record button (`toggle-recording.ts`) — here we additionally
 * surface the HUD first so the user sees the "● запись" indicator (on start) or
 * the streaming answer (on stop = send, phase-9 "stop = finished question").
 */
async function toggleRecordingHotkey(container: HotkeysContainer): Promise<void> {
  await container.platform.overlay.show();
  await toggleRecording(container.useCases);
}

/**
 * Wires the app's global hotkeys. This is a bootstrap (composition-root)
 * concern — the only place that connects `HotkeyPort`, the capture use-case,
 * and `OverlayPort` (architecture.md §8: platform ports are wired by bootstrap,
 * never by UI components).
 *
 * The six hotkeys are registered independently (`allSettled`) so a conflict
 * on one accelerator (e.g. already taken by another app) does not prevent the
 * others from registering. If any registration fails, the aggregated error is
 * rethrown so the caller can surface it (`ServicesProvider` shows the HUD with
 * an error banner as a stopgap) — failures are never swallowed.
 */
export async function registerHotkeys(
  container: HotkeysContainer,
  bindings: HotkeySettings = DEFAULT_HOTKEYS,
): Promise<void> {
  const { hotkey } = container.platform;

  const results = await Promise.allSettled([
    hotkey.register(bindings.toggleHud, () => {
      void toggleHud(container);
    }),
    hotkey.register(bindings.capture, () => {
      void captureToBuffer(container);
    }),
    hotkey.register(bindings.captureWindow, () => {
      void captureToBuffer(container, 'active-window');
    }),
    hotkey.register(bindings.send, () => {
      void sendBatch(container);
    }),
    hotkey.register(bindings.record, () => {
      void toggleRecordingHotkey(container);
    }),
    hotkey.register(bindings.pasteCode, () => {
      void pasteCodeFromClipboard(container);
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
  bindings: HotkeySettings = DEFAULT_HOTKEYS,
): Promise<void> {
  const { hotkey } = container.platform;
  await Promise.allSettled([
    hotkey.unregister(bindings.toggleHud),
    hotkey.unregister(bindings.capture),
    hotkey.unregister(bindings.captureWindow),
    hotkey.unregister(bindings.send),
    hotkey.unregister(bindings.record),
    hotkey.unregister(bindings.pasteCode),
  ]);
}
