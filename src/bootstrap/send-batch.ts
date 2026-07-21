import { useHudStore } from '@/ui/store/hud.store';
import { analyzeAndStream } from './analyze-and-stream';
import { resolveAgent } from '@/core/domain/agents-catalog';
import type { AppContainer } from './container.types';

/**
 * Send the staged screenshot batch (+ current agent/language/instructions, and
 * the loopback transcript if recording) for analysis and stream the answer —
 * the app's main scenario (plan.md §4). Platform-free: it only touches use-cases
 * and the store, so both bootstrap (hotkey) and UI (record button, via
 * use-cases only — architecture.md §8) can call it. `sendBatch` wraps this with
 * `overlay.show()` for the hotkey path.
 *
 * An empty send is only an error when there is NOTHING to send: no staged shots
 * AND no active recording. While recording, an empty batch is allowed — the
 * runner falls back to a single fresh capture so an audio-only question (voice +
 * whatever is on screen now) still works.
 */
export async function runSend(useCases: AppContainer['useCases']): Promise<void> {
  const { screenshots, recording, agentId, language, instructions } = useHudStore.getState();
  if (screenshots.length === 0 && !recording) {
    useHudStore
      .getState()
      .fail('Нет скриншотов для анализа — сделайте хотя бы один (хоткей захвата).');
    return;
  }

  await analyzeAndStream(useCases, {
    agent: resolveAgent(agentId),
    language,
    instructions,
    screenshots,
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
