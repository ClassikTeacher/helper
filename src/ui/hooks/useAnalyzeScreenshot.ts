import { useCallback } from 'react';
import { useServices } from './useServices';
import { useHudStore } from '@/ui/store/hud.store';
import { analyzeAndStream } from '@/bootstrap/analyze-and-stream';

/**
 * Bridges the UI to the analyze-screenshot use-case: streams deltas into the
 * HUD store via the shared `analyzeAndStream` helper (also used by the
 * hotkey wiring, so both paths behave identically). Reuses whatever
 * screenshot is currently pinned in the store — the one the user is actually
 * looking at — instead of capturing a fresh one, which would both waste a
 * capture and risk framing the now-visible HUD itself (nothing hides it for
 * a capture triggered from here).
 */
export function useAnalyzeScreenshot(): (prompt: string) => Promise<void> {
  const { analyzeScreenshot, recordConversation } = useServices();
  const fail = useHudStore((s) => s.fail);

  return useCallback(
    async (prompt: string) => {
      const screenshot = useHudStore.getState().screenshot;
      if (!screenshot) {
        fail('No screenshot yet — press the screenshot hotkey first.');
        return;
      }
      await analyzeAndStream({ analyzeScreenshot, recordConversation }, { prompt, screenshot });
    },
    [analyzeScreenshot, recordConversation, fail],
  );
}
