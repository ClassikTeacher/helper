use tauri::State;

use crate::dto::{SecretGetRequest, SecretGetResult, SecretSetRequest};
use crate::AppState;

#[tauri::command]
pub fn secret_get(
    state: State<'_, AppState>,
    request: SecretGetRequest,
) -> Result<SecretGetResult, String> {
    let value = state.secrets.get(&request.key)?;
    Ok(SecretGetResult { value })
}

#[tauri::command]
pub fn secret_set(state: State<'_, AppState>, request: SecretSetRequest) -> Result<(), String> {
    state.secrets.set(&request.key, &request.value)
}
