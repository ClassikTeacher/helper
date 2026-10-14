import { useHudStore } from '@/ui/store/hud.store';
import { analyzeAndStream, askAndStream } from './analyze-and-stream';
import { resolveAgent } from '@/core/domain/agents-catalog';
import type { AppContainer } from './container.types';

/**
 * Send the next message of the current mode's dialog and stream the answer —
 * the app's main scenario (plan.md §4). What is sent depends on what is staged:
 * - screenshots and/or pasted code (R15) and/or an active recording → an
 *   analysis of the batch (+ the current agent/language/instructions and the
 *   loopback transcript). While recording, an empty batch is allowed — the
 *   runner falls back to a single fresh capture, so an audio-only question
 *   (voice + whatever is on screen now) still works;
 * - nothing but typed text → a text message (a follow-up on an earlier answer
 *   or a standalone question);
 * - nothing at all → an error.
 * Either way the dialog so far goes along as context.
 *
 * Platform-free: it only touches use-cases and the store, so both bootstrap
 * (hotkey) and UI (Run and record buttons, via use-cases only — architecture.md
 * §8) can call it. `sendBatch` wraps this with `overlay.show()` for the hotkey
 * path.
 */
export async function runSend(useCases: AppContainer['useCases']): Promise<void> {
  const { screenshots, recording, transcribing, agentId, language, instructions, codeText } =
    useHudStore.getState();
  // While the previous send is still transcribing, a new send is ignored: its
  // audio is already being processed and would otherwise be lost (a send
  // DURING streaming is fine — it supersedes the running answer, see run-control).
  if (transcribing) return;
  const agent = resolveAgent(agentId);
  if (screenshots.length === 0 && !recording && !codeText.trim()) {
    if (instructions.trim()) {
      await askAndStream(useCases, { agent, language, question: instructions });
      return;
    }
    useHudStore
      .getState()
      .fail(
        'Нет данных для отправки — сделайте скриншот (хоткей захвата), вставьте код текстом или напишите вопрос.',
      );
    return;
  }

  await analyzeAndStream(useCases, {
    agent,
    language,
    instructions,
    screenshots,
    ...(codeText.trim() ? { codeText } : {}),
  });
}

/**
 * `runSend` preceded by `overlay.show()`. Used by the send hotkey (and any other
 * bootstrap path) so the HUD is revealed before the answer streams. UI callers
 * that are already inside the visible HUD use `runSend` directly instead, to
 * stay off the platform ports.
 */
export async function sendBatch(
  container: Pick<AppContainer, 'platform' | 'useCases'>,
): Promise<void> {
  await container.platform.overlay.show();
  await runSend(container.useCases);
}
