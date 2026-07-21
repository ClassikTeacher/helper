import { useHudStore } from '@/ui/store/hud.store';
import { runSend } from './send-batch';
import type { AppContainer } from './container.types';

/**
 * Toggle loopback audio recording (phase 9).
 *
 * - **Idle → start:** begin native WASAPI loopback capture and flip the store
 *   `recording` flag the UI reflects. Also clears any leftover transcript preview
 *   from a previous run.
 * - **Recording → stop = SEND:** stopping the recording is treated as "the
 *   question is finished" (user decision 2026-07-21), so it immediately sends the
 *   staged batch via `runSend`. The send flow (`analyzeAndStream`) is what
 *   actually stops the recorder and transcribes, attaching the transcript to the
 *   screenshots — so we do NOT stop it here, we hand off with `recording` still
 *   true and let the send flow drain it.
 *
 * Takes only use-cases (not platform) so the HUD record button can call it
 * without reaching a platform port (architecture.md §8); the record hotkey shows
 * the overlay itself before delegating here. Shared by both so they behave
 * identically. A start failure is surfaced in the HUD and leaves recording off —
 * never swallowed.
 */
export async function toggleRecording(useCases: AppContainer['useCases']): Promise<void> {
  const store = useHudStore.getState();

  if (store.recording) {
    // Stop = send. `runSend` → `analyzeAndStream` stops the recorder and
    // transcribes (its own errors are surfaced via `fail`).
    await runSend(useCases);
    return;
  }

  try {
    await useCases.transcribeAudio.startRecording();
    store.setRecording(true);
    // Drop a stale transcript preview so the HUD reflects only this recording.
    if (store.transcript) store.setTranscript('');
  } catch (err) {
    store.setRecording(false);
    store.fail(err instanceof Error ? err.message : String(err));
  }
}
