import { useHudStore } from '@/ui/store/hud.store';
import { toggleRecording } from './toggle-recording';
import type { TrayAction } from '@/core/application/ports/tray.port';
import type { AppContainer } from './container.types';

type TrayContainer = Pick<AppContainer, 'platform' | 'useCases'>;

/**
 * Wires the tray's webview-side actions (F1) — a bootstrap concern like the
 * hotkeys: the only place that connects `TrayPort` to use-cases and the
 * overlay. Resolves to the unsubscribe function.
 */
export function installTrayActions(container: TrayContainer): Promise<() => void> {
  return container.platform.tray.onAction((action) => {
    void handleTrayAction(container, action);
  });
}

/**
 * "Stop recording" from the tray behaves exactly like the record hotkey's
 * second press: show the HUD, then stop = send (`toggleRecording`). It only
 * acts while the webview agrees a recording is on — the store drives the
 * send flow, and a stale menu click must never START a recording.
 */
export async function handleTrayAction(container: TrayContainer, action: TrayAction): Promise<void> {
  switch (action) {
    case 'stop-recording': {
      if (!useHudStore.getState().recording) return;
      await container.platform.overlay.show();
      await toggleRecording(container.useCases);
      return;
    }
  }
}
