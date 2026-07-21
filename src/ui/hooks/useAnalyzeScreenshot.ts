import { useCallback } from 'react';
import { useServices } from './useServices';
import { runSend } from '@/bootstrap/send-batch';

/**
 * Bridges the UI to the send flow: streams the analysis of the staged screenshot
 * batch (phase 8) into the HUD store via the shared `runSend` helper (also used
 * by the send hotkey and the record "stop = send" path, so all behave
 * identically). Reads the selected agent/language/instructions and the staged
 * shots from the store, and — if a recording is active — attaches its transcript
 * (phase 9). Backs the "Run"/send button in the HUD; platform-free, so it stays
 * off the platform ports (architecture.md §8).
 */
export function useAnalyzeScreenshot(): () => Promise<void> {
  const useCases = useServices();
  return useCallback(() => runSend(useCases), [useCases]);
}
