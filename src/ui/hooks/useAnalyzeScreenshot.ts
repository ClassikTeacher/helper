import { useCallback } from 'react';
import { useServices } from './useServices';
import { useHudStore } from '@/ui/store/hud.store';

/**
 * Bridges the UI to the analyze-screenshot use-case: streams deltas into the HUD
 * store. This is the only place a component "talks to logic", and it does so
 * through the injected use-case — no infrastructure imports.
 */
export function useAnalyzeScreenshot(): (prompt: string) => Promise<void> {
  const { analyzeScreenshot } = useServices();
  const startStreaming = useHudStore((s) => s.startStreaming);
  const appendAnswer = useHudStore((s) => s.appendAnswer);
  const finishStreaming = useHudStore((s) => s.finishStreaming);
  const fail = useHudStore((s) => s.fail);

  return useCallback(
    async (prompt: string) => {
      startStreaming();
      try {
        for await (const delta of analyzeScreenshot.execute({ prompt })) {
          appendAnswer(delta);
        }
        finishStreaming();
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    },
    [analyzeScreenshot, startStreaming, appendAnswer, finishStreaming, fail],
  );
}
