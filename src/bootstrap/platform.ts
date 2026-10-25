/** True inside a Tauri webview (the IPC bridge is present), false in a plain browser/tests. */
export function isTauriWindow(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
