import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import { TauriDiagnosticsAdapter } from '@/infrastructure/tauri/tauri-diagnostics.adapter';
import type { DiagnosticsSnapshotDto } from '@/core/contracts/dto';

/** The wire shape as serde emits it (see tests/contract/dto-fixtures.generated.ts). */
const diagnosticsSnapshot: DiagnosticsSnapshotDto = {
  appVersion: '0.0.0',
  arch: 'x86_64',
  logPath: 'C:\\Users\\me\\AppData\\Local\\com.aihelper.app\\logs\\ai-helper.log',
  logTail: '[INFO] started\n',
  os: 'windows',
};

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  mockInvoke.mockReset();
});

describe('TauriDiagnosticsAdapter', () => {
  it('asks diagnostics_snapshot (no arguments) and maps the DTO field for field', async () => {
    mockInvoke.mockResolvedValue(diagnosticsSnapshot);
    const snapshot = await new TauriDiagnosticsAdapter().snapshot();

    expect(mockInvoke).toHaveBeenCalledWith(IPC_COMMANDS.diagnosticsSnapshot);
    expect(snapshot).toEqual({
      appVersion: diagnosticsSnapshot.appVersion,
      os: diagnosticsSnapshot.os,
      arch: diagnosticsSnapshot.arch,
      logPath: diagnosticsSnapshot.logPath,
      logTail: diagnosticsSnapshot.logTail,
    });
  });

  it('propagates a native failure', async () => {
    mockInvoke.mockRejectedValue(new Error('no log dir'));
    await expect(new TauriDiagnosticsAdapter().snapshot()).rejects.toThrow('no log dir');
  });
});
