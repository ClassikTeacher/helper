/**
 * Port: actions the user triggers from the system tray that the webview must
 * carry out (F1). The tray itself is native (`src-tauri/src/tray.rs`): its
 * show/hide and quit items are handled there; "stop recording" is forwarded
 * here because stopping a recording means "send the question" (phase 9), and
 * that flow lives in the webview.
 */
export type TrayAction = 'stop-recording';

export const TRAY_ACTIONS: readonly TrayAction[] = ['stop-recording'];

export function isTrayAction(value: string): value is TrayAction {
  return (TRAY_ACTIONS as readonly string[]).includes(value);
}

export type TrayActionHandler = (action: TrayAction) => void;

export interface TrayPort {
  /** Subscribe to tray actions; resolves to the unsubscribe function. */
  onAction(handler: TrayActionHandler): Promise<() => void>;
}
