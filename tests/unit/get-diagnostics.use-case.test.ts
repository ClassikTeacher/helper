import { describe, it, expect } from 'vitest';
import { GetDiagnosticsUseCase, formatDiagnostics } from '@/core/application/use-cases/get-diagnostics.use-case';
import { FakeDiagnosticsAdapter } from '@/infrastructure/mocks/fake-diagnostics.adapter';
import type { DiagnosticsSnapshot } from '@/core/application/ports/diagnostics.port';

const snapshot: DiagnosticsSnapshot = {
  appVersion: '0.3.1',
  os: 'windows',
  arch: 'x86_64',
  logPath: 'C:\\Users\\me\\AppData\\Local\\com.aihelper.app\\logs\\ai-helper.log',
  logTail: '[INFO] started v0.3.1\n[WARN] llm_stream: image left unscaled\n\n',
};

const at = new Date('2026-10-25T12:34:56.000Z');

describe('formatDiagnostics', () => {
  it('renders a pasteable report: header, platform line, log path, then the log tail', () => {
    expect(formatDiagnostics(snapshot, at)).toBe(
      [
        'AI-Helper diagnostics',
        'version: 0.3.1 · platform: windows/x86_64 · copied: 2026-10-25T12:34:56.000Z',
        'log: C:\\Users\\me\\AppData\\Local\\com.aihelper.app\\logs\\ai-helper.log',
        '--- last log lines ---',
        '[INFO] started v0.3.1',
        '[WARN] llm_stream: image left unscaled',
      ].join('\n'),
    );
  });

  it('marks an empty log tail explicitly instead of ending with nothing', () => {
    const text = formatDiagnostics({ ...snapshot, logTail: '  \n' }, at);
    expect(text.endsWith('--- last log lines ---\n(empty)')).toBe(true);
  });
});

describe('GetDiagnosticsUseCase', () => {
  it('formats whatever the port returns, stamped with the injected clock', async () => {
    const useCase = new GetDiagnosticsUseCase(new FakeDiagnosticsAdapter(snapshot), () => at);
    const text = await useCase.execute();
    expect(text).toContain('version: 0.3.1');
    expect(text).toContain('copied: 2026-10-25T12:34:56.000Z');
    expect(text).toContain('[WARN] llm_stream: image left unscaled');
  });
});
