import { useCallback, useState } from 'react';
import { useServices } from './useServices';
import { copyText } from '@/ui/lib/copy-text';

export type DiagnosticsCopyStatus = 'idle' | 'copying' | 'copied' | 'error';

export interface DiagnosticsControls {
  readonly status: DiagnosticsCopyStatus;
  /** Fetch the diagnostics text and put it on the clipboard. */
  readonly copy: () => Promise<void>;
}

/**
 * Backs "Copy diagnostics" in the settings panel: the text comes from
 * `GetDiagnosticsUseCase`, the clipboard write happens here inside the click
 * (a user gesture — same as the code-block copy button).
 */
export function useDiagnostics(): DiagnosticsControls {
  const { getDiagnostics } = useServices();
  const [status, setStatus] = useState<DiagnosticsCopyStatus>('idle');

  const copy = useCallback(async () => {
    setStatus('copying');
    try {
      const ok = await copyText(await getDiagnostics.execute());
      setStatus(ok ? 'copied' : 'error');
    } catch {
      setStatus('error');
    }
  }, [getDiagnostics]);

  return { status, copy };
}
