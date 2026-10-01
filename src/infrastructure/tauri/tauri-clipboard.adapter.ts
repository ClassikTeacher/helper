import { readText } from '@tauri-apps/plugin-clipboard-manager';
import type { ClipboardPort } from '@/core/application/ports/clipboard.port';

/**
 * Native adapter for ClipboardPort over `tauri-plugin-clipboard-manager`
 * (permission `clipboard-manager:allow-read-text`). Non-text clipboard content
 * (e.g. an image) makes the plugin reject — reported as "no text".
 */
export class TauriClipboardAdapter implements ClipboardPort {
  async readText(): Promise<string> {
    try {
      return (await readText()) ?? '';
    } catch {
      return '';
    }
  }
}
