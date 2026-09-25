use tauri::{AppHandle, State};

use crate::dto::{CaptureRequest, CaptureResult};
use crate::AppState;

/// Captures a screenshot. Without an explicit display, it targets the monitor
/// under the mouse cursor (P0): on a multi-monitor setup the task is on the
/// screen the user is looking at, not necessarily the primary one. Detection is
/// best-effort — if it fails, the capturer falls back to the primary display.
#[tauri::command]
pub fn capture_screen(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CaptureRequest,
) -> Result<CaptureResult, String> {
    let mut request = request;
    if request.display_index.is_none() && request.display_name.is_none() {
        request.display_name = monitor_under_cursor(&app);
    }
    state.capture.capture(&request)
}

/// OS device name of the monitor containing the cursor (physical coordinates).
fn monitor_under_cursor(app: &AppHandle) -> Option<String> {
    let cursor = app.cursor_position().ok()?;
    app.monitor_from_point(cursor.x, cursor.y).ok()??.name().cloned()
}
