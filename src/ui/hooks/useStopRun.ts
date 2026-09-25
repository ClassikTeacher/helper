import { useCallback, useEffect } from 'react';
import { stopRun } from '@/bootstrap/run-control';

/**
 * Stop for the running answer (P0): the Stop button and the Esc key while the
 * HUD has focus. Platform-free — it only aborts the run's AbortSignal; the
 * LLM adapter turns that into a native `llm_cancel`.
 */
export function useStopRun(streaming: boolean): () => void {
  const stop = useCallback(() => {
    stopRun();
  }, []);

  useEffect(() => {
    if (!streaming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [streaming, stop]);

  return stop;
}
