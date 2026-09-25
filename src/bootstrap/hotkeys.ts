import { useHudStore, MAX_SCREENSHOTS } from '@/ui/store/hud.store';
import { sendBatch } from './send-batch';
import { toggleRecording } from './toggle-recording';
import type { AppContainer } from './container.types';

/** The bootstrap slice the hotkey wiring needs: the capture use-case + overlay. */
type HotkeysContainer = Pick<AppContainer, 'platform' | 'useCases'>;

/**
 * Five distinct global hotkeys. Overridable via `VITE_*` env vars
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
 * Toggle loopback audio recording (phase 9) — captures the output device (the
 * interlocutor's voice). The captured audio is transcribed and attached to the
 * batch when `SEND_ACCELERATOR` fires. Override via `VITE_RECORD_ACCELERATOR`.
 */
export const RECORD_ACCELERATOR =
  import.meta.env.VITE_RECORD_ACCELERATOR || 'CommandOrControl+Alt+L';

/**
 * Stage the clipboard's text as the code for the next send (R15). The user
 * selects code in the editor, copies it, and fires this — the exact text then
 * travels as a numbered `<code_text>` block instead of being read from pixels.
 * Default `Ctrl+Alt+X` avoids common IDE bindings (`Ctrl+Alt+V`/`C` are
 * JetBrains refactorings). Override via `VITE_PASTE_CODE_ACCELERATOR`.
 */
export const PASTE_CODE_ACCELERATOR =
  import.meta.env.VITE_PASTE_CODE_ACCELERATOR || 'CommandOrControl+Alt+X';

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
 * Read the clipboard into the staged code text (R15) and show the HUD. An
 * empty/non-text clipboard is reported in the HUD instead of silently staging
 * nothing.
 */
async function pasteCodeFromClipboard(container: HotkeysContainer): Promise<void> {
  const text = await container.platform.clipboard.readText();
  if (text.trim()) {
    useHudStore.getState().setCodeText(text);
  } else {
    useHudStore.getState().fail('Буфер обмена не содержит текста — скопируйте код и повторите.');
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
 * The five hotkeys are registered independently (`allSettled`) so a conflict
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
      void sendBatch(container);
    }),
    hotkey.register(RECORD_ACCELERATOR, () => {
      void toggleRecordingHotkey(container);
    }),
    hotkey.register(PASTE_CODE_ACCELERATOR, () => {
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
): Promise<void> {
  const { hotkey } = container.platform;
  await Promise.allSettled([
    hotkey.unregister(TOGGLE_HUD_ACCELERATOR),
    hotkey.unregister(CAPTURE_ACCELERATOR),
    hotkey.unregister(SEND_ACCELERATOR),
    hotkey.unregister(RECORD_ACCELERATOR),
    hotkey.unregister(PASTE_CODE_ACCELERATOR),
  ]);
}
