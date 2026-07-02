use tauri::State;

use crate::dto::{CaptureRequest, CaptureResult};
use crate::AppState;

#[tauri::command]
pub fn capture_screen(
    state: State<'_, AppState>,
    request: CaptureRequest,
) -> Result<CaptureResult, String> {
    state.capture.capture(&request)
}
