//! `diagnostics_snapshot` — what the user pastes into a bug report (2026-10
//! review §5.5): app version, OS/arch, and the tail of the native log file
//! written by `tauri-plugin-log`. The log carries no secrets, prompts,
//! screenshots or transcripts (logging policy in `lib.rs`), so the snapshot is
//! safe to share as-is.

use tauri::{AppHandle, Manager};

use crate::dto::DiagnosticsSnapshot;
use crate::LOG_FILE_STEM;

/// How much of the log file's end goes into the snapshot.
const MAX_TAIL_BYTES: usize = 32 * 1024;

/// `async`: file I/O must not run on the main thread.
#[tauri::command(async)]
pub fn diagnostics_snapshot(app: AppHandle) -> Result<DiagnosticsSnapshot, String> {
    let log_path = app
        .path()
        .app_log_dir()
        .map_err(|e| e.to_string())?
        .join(format!("{LOG_FILE_STEM}.log"));
    let log_tail = match std::fs::read(&log_path) {
        Ok(bytes) => tail_lines(&bytes, MAX_TAIL_BYTES),
        Err(e) => format!("(log file not readable: {e})"),
    };
    Ok(DiagnosticsSnapshot {
        app_version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        log_path: log_path.display().to_string(),
        log_tail,
    })
}

/// The last `max_bytes` of `bytes`, moved forward to the next line start so
/// the tail never begins mid-line (and so never mid-UTF-8 sequence). Pure.
pub fn tail_lines(bytes: &[u8], max_bytes: usize) -> String {
    if bytes.len() <= max_bytes {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    let start = bytes.len() - max_bytes;
    // The byte before the window ends a line → the window already starts on a
    // line boundary; otherwise skip the partial line.
    let cut = if start == 0 || bytes[start - 1] == b'\n' {
        start
    } else {
        bytes[start..]
            .iter()
            .position(|&b| b == b'\n')
            .map_or(bytes.len(), |i| start + i + 1)
    };
    String::from_utf8_lossy(&bytes[cut..]).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_lines_returns_everything_when_it_fits() {
        assert_eq!(tail_lines(b"a\nb\n", 100), "a\nb\n");
        assert_eq!(tail_lines(b"", 100), "");
    }

    #[test]
    fn tail_lines_starts_at_a_line_boundary() {
        let log = b"line one\nline two\nline three\n";
        // 12 bytes from the end lands inside "line two" — skip to "line three".
        assert_eq!(tail_lines(log, 12), "line three\n");
        // Exactly at a boundary: keep that line.
        assert_eq!(tail_lines(log, 11), "line three\n");
    }

    #[test]
    fn tail_lines_never_splits_a_multibyte_character() {
        let log = "первая\nвторая строка\n".as_bytes();
        // 10 bytes from the end lands inside "строка" and no line starts after
        // that point — nothing whole to return.
        assert_eq!(tail_lines(log, 10), "");
        // 28 bytes from the end lands between the two bytes of the "я" of
        // "первая": skip to the next line instead of emitting a broken char.
        assert_eq!(tail_lines(log, 28), "вторая строка\n");
        // Exactly at the boundary after the first "\n": keep the whole line.
        assert_eq!(tail_lines(log, 26), "вторая строка\n");
    }

    #[test]
    fn tail_lines_with_no_newline_in_window_returns_empty() {
        assert_eq!(tail_lines(b"abcdefghij", 3), "");
    }
}
