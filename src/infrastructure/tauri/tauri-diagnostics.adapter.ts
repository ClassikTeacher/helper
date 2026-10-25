import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type { DiagnosticsSnapshotDto } from '@/core/contracts/dto';
import type { DiagnosticsPort, DiagnosticsSnapshot } from '@/core/application/ports/diagnostics.port';

/** Native adapter for DiagnosticsPort — the `diagnostics_snapshot` command. */
export class TauriDiagnosticsAdapter implements DiagnosticsPort {
  async snapshot(): Promise<DiagnosticsSnapshot> {
    const dto = await invoke<DiagnosticsSnapshotDto>(IPC_COMMANDS.diagnosticsSnapshot);
    return {
      appVersion: dto.appVersion,
      os: dto.os,
      arch: dto.arch,
      logPath: dto.logPath,
      logTail: dto.logTail,
    };
  }
}
