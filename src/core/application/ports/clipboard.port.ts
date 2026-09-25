/**
 * Port: read plain text from the OS clipboard (R15 — the paste-code hotkey
 * stages copied code as `<code_text>`). Native in a Tauri window (a global
 * hotkey carries no user gesture, so the webview Clipboard API can't be used);
 * `navigator.clipboard` in a plain browser.
 */
export interface ClipboardPort {
  /** The clipboard's text content; empty string when it holds no text. */
  readText(): Promise<string>;
}
