import type { DiagnosticsPort, DiagnosticsSnapshot } from '@/core/application/ports/diagnostics.port';

/** DiagnosticsPort for the browser (`pnpm dev`) and tests — a fixed snapshot. */
export class FakeDiagnosticsAdapter implements DiagnosticsPort {
  constructor(
    private readonly fixed: DiagnosticsSnapshot = {
      appVersion: '0.0.0-dev',
      os: 'browser',
      arch: 'n/a',
      logPath: '(no native log in the browser)',
      logTail: '',
    },
  ) {}

  async snapshot(): Promise<DiagnosticsSnapshot> {
    return this.fixed;
  }
}
