import { error as logError, warn as logWarn } from '@tauri-apps/plugin-log';

/**
 * Forwards the webview's `console.error`/`console.warn` and uncaught failures
 * to the native log file (tauri-plugin-log), so a "the hotkey did nothing"
 * report carries what actually happened (2026-10 review §5.5). Bootstrap-only
 * — no other layer imports the plugin. Nothing here adds content: the lines
 * are whatever the code already writes to the console, which by the logging
 * policy (lib.rs) are errors and sizes, never prompts, screenshots,
 * transcripts or the key.
 */
export function installLogForwarding(): void {
  console.error = forward(logError, console.error.bind(console));
  console.warn = forward(logWarn, console.warn.bind(console));
  window.addEventListener('error', (event) => {
    void logError(`uncaught: ${event.message} (${event.filename}:${event.lineno})`).catch(() => {});
  });
  window.addEventListener('unhandledrejection', (event) => {
    void logError(`unhandled rejection: ${describe(event.reason)}`).catch(() => {});
  });
}

type ConsoleMethod = (...args: unknown[]) => void;

function forward(sink: (message: string) => Promise<void>, original: ConsoleMethod): ConsoleMethod {
  return (...args: unknown[]) => {
    original(...args);
    // Best effort: a logging failure must never surface as an app error.
    void sink(args.map(describe).join(' ')).catch(() => {});
  };
}

/** One-line rendering of a console argument. */
export function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
