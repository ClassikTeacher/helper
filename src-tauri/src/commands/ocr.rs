use tauri::State;

use crate::dto::{OcrRequest, OcrResult};
use crate::AppState;

/// Local OCR of one screenshot (phase 6). Runs on a blocking thread: model
/// inference takes on the order of a second and must not stall the IPC loop.
#[tauri::command]
pub async fn ocr_image(state: State<'_, AppState>, request: OcrRequest) -> Result<OcrResult, String> {
    let ocr = state.ocr.clone();
    tauri::async_runtime::spawn_blocking(move || ocr.recognize(&request))
        .await
        .map_err(|e| format!("OCR task failed: {e}"))?
}
