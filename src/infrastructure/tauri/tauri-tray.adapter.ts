import { listen } from '@tauri-apps/api/event';
import { IPC_EVENTS } from '@/core/contracts/ipc-events';
import type { TrayActionPayloadDto } from '@/core/contracts/dto';
import { isTrayAction, type TrayActionHandler, type TrayPort } from '@/core/application/ports/tray.port';

/**
 * Native adapter for TrayPort — listens to the `tray://action` event the Rust
 * tray emits (F1). Unknown actions (a newer native, an older webview) are
 * ignored rather than crashing the handler.
 */
export class TauriTrayAdapter implements TrayPort {
  async onAction(handler: TrayActionHandler): Promise<() => void> {
    return listen<TrayActionPayloadDto>(IPC_EVENTS.trayAction, (event) => {
      const action = event.payload?.action;
      if (typeof action === 'string' && isTrayAction(action)) handler(action);
    });
  }
}
