import { useCallback } from 'react';
import { useServices } from './useServices';
import { useHudStore } from '@/ui/store/hud.store';
import { analyzeAndStream } from '@/bootstrap/analyze-and-stream';
import { resolveAgent } from '@/core/domain/agents-catalog';

/**
 * Bridges the UI to the analyze-screenshot use-case: streams deltas into the
 * HUD store via the shared `analyzeAndStream` helper (also used by the hotkey
 * wiring, so both paths behave identically). Reads the currently-selected
 * agent, language, and instructions from the store, and reuses whatever
 * screenshot is currently pinned — the one the user is actually looking at —
 * instead of capturing a fresh one, which would both waste a capture and risk
 * framing the now-visible HUD itself (nothing hides it for a capture triggered
 * from here).
 */
export function useAnalyzeScreenshot(): () => Promise<void> {
  const { analyzeScreenshot, recordConversation } = useServices();
  const fail = useHudStore((s) => s.fail);

  return useCallback(async () => {
    const { screenshot, agentId, language, instructions } = useHudStore.getState();
    if (!screenshot) {
      fail('No screenshot yet — press the screenshot hotkey first.');
      return;
    }
    await analyzeAndStream(
      { analyzeScreenshot, recordConversation },
      { agent: resolveAgent(agentId), language, instructions, screenshot },
    );
  }, [analyzeScreenshot, recordConversation, fail]);
}
