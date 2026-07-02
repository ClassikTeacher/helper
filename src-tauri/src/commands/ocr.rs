use tauri::State;

use crate::dto::{OcrRequest, OcrResult};
use crate::AppState;

#[tauri::command]
pub fn ocr_image(state: State<'_, AppState>, request: OcrRequest) -> Result<OcrResult, String> {
    state.ocr.recognize(&request)
}
