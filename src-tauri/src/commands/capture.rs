use std::time::Instant;

use tauri::{AppHandle, Manager, State};

use crate::dto::{CaptureRequest, CaptureResult, CaptureTarget};
use crate::infra::foreground_window::{foreground_window, pick_window};
use crate::ports::{CaptureSpec, CaptureTargetSpec};
use crate::AppState;

/// Captures a screenshot. Without an explicit display, it targets the monitor
/// under the mouse cursor (P0): on a multi-monitor setup the task is on the
/// screen the user is looking at, not necessarily the primary one. Detection is
/// best-effort — if it fails, the capturer falls back to the primary display.
///
/// `target: "active-window"` (F5) captures the foreground window instead —
/// the IDE alone, without the second monitor, panels and chat — and falls
/// back to the monitor when there is no capturable window (none, minimized,
/// our own HUD) or the window capture fails. The result's `source` tells the
/// webview which one it got.
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
    let started = Instant::now();
    let display = display_spec(&request, || monitor_under_cursor(&app));
    let wants_window = request.target == Some(CaptureTarget::ActiveWindow);
    let window = if wants_window { active_window_spec(&app, &request) } else { None };

    let result = match window {
        Some(spec) => match state.capture.capture(&spec) {
            Ok(shot) => Ok(shot),
            Err(e) => {
                log::warn!("capture_screen: active window capture failed ({e}); falling back to the monitor");
                state.capture.capture(&display)
            }
        },
        None => {
            if wants_window {
                log::info!("capture_screen: no capturable foreground window, capturing the monitor");
            }
            state.capture.capture(&display)
        }
    };

    match &result {
        Ok(shot) => log::info!(
            "capture_screen: {:?} {}x{} ({} KB png) from {} in {} ms",
            shot.source,
            shot.width,
            shot.height,
            shot.image_base64.len() * 3 / 4 / 1024,
            describe(&display.target),
            started.elapsed().as_millis()
        ),
        Err(e) => log::warn!("capture_screen failed: {e}"),
    }
    result
}

/// The display to capture: an explicit index/name from the request, else the
/// monitor under the cursor, else scap's main display. Pure given the cursor
/// lookup.
fn display_spec(request: &CaptureRequest, cursor_monitor: impl FnOnce() -> Option<String>) -> CaptureSpec {
    let target = if let Some(index) = request.display_index {
        CaptureTargetSpec::DisplayIndex(index)
    } else if let Some(name) = request.display_name.clone() {
        CaptureTargetSpec::DisplayName(name)
    } else if let Some(name) = cursor_monitor() {
        CaptureTargetSpec::DisplayName(name)
    } else {
        CaptureTargetSpec::MainDisplay
    };
    CaptureSpec {
        target,
        region: request.region.clone(),
    }
}

/// The foreground window as a capture spec, unless it is not worth capturing
/// (see `pick_window`).
fn active_window_spec(app: &AppHandle, request: &CaptureRequest) -> Option<CaptureSpec> {
    let hud = app
        .get_webview_window(crate::MAIN_WINDOW_LABEL)
        .and_then(|window| hud_handle(&window));
    let hwnd = pick_window(foreground_window(), hud)?;
    Some(CaptureSpec {
        target: CaptureTargetSpec::Window { hwnd },
        region: request.region.clone(),
    })
}

#[cfg(windows)]
fn hud_handle(window: &tauri::WebviewWindow) -> Option<isize> {
    window.hwnd().ok().map(|hwnd| hwnd.0 as isize)
}

#[cfg(not(windows))]
fn hud_handle(_window: &tauri::WebviewWindow) -> Option<isize> {
    None
}

/// OS device name of the monitor containing the cursor (physical coordinates).
fn monitor_under_cursor(app: &AppHandle) -> Option<String> {
    let cursor = app.cursor_position().ok()?;
    app.monitor_from_point(cursor.x, cursor.y).ok()??.name().cloned()
}

/// For the log line: which display the monitor path resolved to.
fn describe(target: &CaptureTargetSpec) -> String {
    match target {
        CaptureTargetSpec::MainDisplay => "main display".to_string(),
        CaptureTargetSpec::DisplayIndex(index) => format!("display #{index}"),
        CaptureTargetSpec::DisplayName(name) => name.clone(),
        CaptureTargetSpec::Window { hwnd } => format!("window {hwnd:#x}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::CaptureRegion;

    #[test]
    fn display_spec_prefers_the_explicit_index_then_name_then_cursor_then_main() {
        let region = CaptureRegion {
            x: 1,
            y: 2,
            width: 3,
            height: 4,
        };
        let by_index = CaptureRequest {
            region: Some(region.clone()),
            display_index: Some(2),
            display_name: Some(r"\\.\DISPLAY1".to_string()),
            target: None,
        };
        let spec = display_spec(&by_index, || Some(r"\\.\DISPLAY3".to_string()));
        assert_eq!(spec.target, CaptureTargetSpec::DisplayIndex(2));
        assert_eq!(spec.region, Some(region));

        let by_name = CaptureRequest {
            display_name: Some(r"\\.\DISPLAY1".to_string()),
            ..CaptureRequest::default()
        };
        let spec = display_spec(&by_name, || Some(r"\\.\DISPLAY3".to_string()));
        assert_eq!(spec.target, CaptureTargetSpec::DisplayName(r"\\.\DISPLAY1".to_string()));

        let spec = display_spec(&CaptureRequest::default(), || Some(r"\\.\DISPLAY3".to_string()));
        assert_eq!(spec.target, CaptureTargetSpec::DisplayName(r"\\.\DISPLAY3".to_string()));

        let spec = display_spec(&CaptureRequest::default(), || None);
        assert_eq!(spec.target, CaptureTargetSpec::MainDisplay);
        assert_eq!(spec.region, None);
    }

    #[test]
    fn active_window_requests_still_resolve_a_display_for_the_fallback() {
        let request = CaptureRequest {
            target: Some(CaptureTarget::ActiveWindow),
            ..CaptureRequest::default()
        };
        let spec = display_spec(&request, || Some(r"\\.\DISPLAY2".to_string()));
        assert_eq!(spec.target, CaptureTargetSpec::DisplayName(r"\\.\DISPLAY2".to_string()));
    }

    #[test]
    fn describe_names_every_target_kind() {
        assert_eq!(describe(&CaptureTargetSpec::MainDisplay), "main display");
        assert_eq!(describe(&CaptureTargetSpec::DisplayIndex(1)), "display #1");
        assert_eq!(describe(&CaptureTargetSpec::DisplayName("D".into())), "D");
        assert_eq!(describe(&CaptureTargetSpec::Window { hwnd: 255 }), "window 0xff");
    }
}
