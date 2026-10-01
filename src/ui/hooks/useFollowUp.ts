import { useCallback } from 'react';
import { useServices } from './useServices';
import { runFollowUp } from '@/bootstrap/send-batch';

/** Backs the HUD's "Уточнить" button (P1 item 9): a follow-up on the current answer. */
export function useFollowUp(): () => Promise<void> {
  const useCases = useServices();
  return useCallback(() => runFollowUp(useCases), [useCases]);
}
