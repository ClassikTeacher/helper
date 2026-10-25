use tauri::{AppHandle, State};

use crate::dto::{CaptureRequest, CaptureResult};
use crate::AppState;

/// Captures a screenshot. Without an explicit display, it targets the monitor
/// under the mouse cursor (P0): on a multi-monitor setup the task is on the
/// screen the user is looking at, not necessarily the primary one. Detection is
/// best-effort — if it fails, the capturer falls back to the primary display.
///
/// `async`: a sync Tauri command runs on the MAIN thread, and this one does
/// real work (WGC frame + BGRA→RGBA + area downscale + PNG encode of a
/// 2560×1440 frame — hundreds of ms in debug), which froze the event loop
/// (window drag, show/hide) for that long (2026-10 review §3.4). With the
/// attribute it runs on the async runtime's pool instead.
#[tauri::command(async)]
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
