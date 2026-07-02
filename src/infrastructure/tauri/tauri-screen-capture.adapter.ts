import { invoke } from '@tauri-apps/api/core';
import { IPC_COMMANDS } from '@/core/contracts/ipc-commands';
import type { CaptureRequestDto, CaptureResultDto } from '@/core/contracts/dto';
import type { CaptureOptions, ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { Screenshot } from '@/core/domain/screenshot';

/**
 * Native adapter for ScreenCapturePort — delegates to the Rust `capture_screen`
 * command across the IPC contract. Swappable: any impl honoring the contract works.
 */
export class TauriScreenCaptureAdapter implements ScreenCapturePort {
  async capture(options?: CaptureOptions): Promise<Screenshot> {
    const request: CaptureRequestDto = {
      ...(options?.region ? { region: options.region } : {}),
      ...(options?.displayIndex !== undefined ? { displayIndex: options.displayIndex } : {}),
    };
    const res = await invoke<CaptureResultDto>(IPC_COMMANDS.captureScreen, { request });
    return {
      imageBase64: res.imageBase64,
      width: res.width,
      height: res.height,
      capturedAt: res.capturedAt,
    };
  }
}
