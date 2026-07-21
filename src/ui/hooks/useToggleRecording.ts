import { useCallback } from 'react';
import { useServices } from './useServices';
import { toggleRecording } from '@/bootstrap/toggle-recording';

/**
 * Backs the HUD's record toggle button (phase 9). Delegates to the shared
 * `toggleRecording` helper (also used by the record hotkey) so button and hotkey
 * behave identically. The recording/transcribing state lives in the HUD store.
 */
export function useToggleRecording(): () => Promise<void> {
  const useCases = useServices();
  // On stop, `toggleRecording` sends the staged batch (phase-9 "stop = finished
  // question"); it needs only use-cases, so the button stays off platform ports.
  return useCallback(() => toggleRecording(useCases), [useCases]);
}
