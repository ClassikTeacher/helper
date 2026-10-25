import type { DiagnosticsPort, DiagnosticsSnapshot } from '@/core/application/ports/diagnostics.port';

/**
 * Use-case: the diagnostics text the user copies into a bug report (⚙ → "Copy
 * diagnostics"). Thin over `DiagnosticsPort`; the formatting is a pure
 * function so the exact shape is unit-tested.
 */
export class GetDiagnosticsUseCase {
  constructor(
    private readonly diagnostics: DiagnosticsPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<string> {
    return formatDiagnostics(await this.diagnostics.snapshot(), this.now());
  }
}

/** Plain text, pasteable into an issue or a chat. */
export function formatDiagnostics(snapshot: DiagnosticsSnapshot, now: Date): string {
  const tail = snapshot.logTail.trimEnd();
  return [
    'AI-Helper diagnostics',
    `version: ${snapshot.appVersion} · platform: ${snapshot.os}/${snapshot.arch} · copied: ${now.toISOString()}`,
    `log: ${snapshot.logPath}`,
    '--- last log lines ---',
    tail.length > 0 ? tail : '(empty)',
  ].join('\n');
}
