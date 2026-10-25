import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type {
  SecretHasResultDto,
  SecretKeyRequestDto,
  SecretSetRequestDto,
} from '@/core/contracts/dto';
import type { SecretsPort } from '@/core/application/ports/secrets.port';

/**
 * Native adapter for SecretsPort over the write-only secret commands. There is
 * no command that returns a secret value, so nothing here can ever bring the
 * key into the renderer (architecture.md §11).
 */
export class TauriSecretsAdapter implements SecretsPort {
  async has(key: string): Promise<boolean> {
    const request: SecretKeyRequestDto = { key };
    const res = await invoke<SecretHasResultDto>(IPC_COMMANDS.secretHas, { request });
    return res.exists;
  }

  async set(key: string, value: string): Promise<void> {
    const request: SecretSetRequestDto = { key, value };
    await invoke<void>(IPC_COMMANDS.secretSet, { request });
  }

  async delete(key: string): Promise<void> {
    const request: SecretKeyRequestDto = { key };
    await invoke<void>(IPC_COMMANDS.secretDelete, { request });
  }
}
