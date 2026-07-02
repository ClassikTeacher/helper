import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type {
  SecretGetRequestDto,
  SecretGetResultDto,
  SecretSetRequestDto,
} from '@/core/contracts/dto';
import type { SecretsPort } from '@/core/application/ports/secrets.port';

/**
 * Native adapter for SecretsPort — reads/writes the OS keychain via Rust.
 */
export class TauriSecretsAdapter implements SecretsPort {
  async get(key: string): Promise<string | null> {
    const request: SecretGetRequestDto = { key };
    const res = await invoke<SecretGetResultDto>(IPC_COMMANDS.secretGet, { request });
    return res.value;
  }

  async set(key: string, value: string): Promise<void> {
    const request: SecretSetRequestDto = { key, value };
    await invoke<void>(IPC_COMMANDS.secretSet, { request });
  }
}
