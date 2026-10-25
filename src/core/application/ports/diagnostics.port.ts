/**
 * What native knows about the running app, for a bug report (2026-10 review
 * §5.5): version, platform, and the tail of the native log file. The log
 * never contains secrets, prompts, screenshots or transcripts (logging policy
 * in `src-tauri/src/lib.rs`), so a snapshot is safe to paste anywhere.
 */
export interface DiagnosticsSnapshot {
  readonly appVersion: string;
  readonly os: string;
  readonly arch: string;
  /** Where the native log file lives, for the user. */
  readonly logPath: string;
  /** The last lines of that file. */
  readonly logTail: string;
}

/** Port: fetch the diagnostics snapshot from native. */
export interface DiagnosticsPort {
  snapshot(): Promise<DiagnosticsSnapshot>;
}
