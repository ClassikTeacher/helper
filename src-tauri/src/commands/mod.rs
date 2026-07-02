//! IPC command handlers — the thin adapter layer. They pull services from
//! managed state (DI) and delegate. Names must match `IPC_COMMANDS` in TS.

pub mod capture;
pub mod llm;
pub mod ocr;
pub mod secrets;

use tauri::WebviewWindow;

#[tauri::command]
pub fn overlay_show(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn overlay_hide(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// Toggles the overlay based on the window's actual OS-level visibility —
/// native is the single source of truth, so the webview adapter never has to
/// track a local "is it visible" flag that could drift out of sync.
#[tauri::command]
pub fn overlay_toggle(window: WebviewWindow) -> Result<(), String> {
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    if visible {
        window.hide().map_err(|e| e.to_string())
    } else {
        window.show().map_err(|e| e.to_string())
    }
}

/// Reads the window's actual OS-level visibility. The read-then-act counterpart
/// to `overlay_toggle` for callers that must know the state before acting (the
/// hotkey captures only when about to show) — same native source of truth.
#[tauri::command]
pub fn overlay_is_visible(window: WebviewWindow) -> Result<bool, String> {
    window.is_visible().map_err(|e| e.to_string())
}
