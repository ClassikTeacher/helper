//! IPC command handlers — the thin adapter layer. They pull services from
//! managed state (DI) and delegate. Names must match `IPC_COMMANDS` in TS.

pub mod audio;
pub mod capture;
pub mod diagnostics;
pub mod llm;
pub mod ocr;
pub mod secrets;

use tauri::{AppHandle, Manager, WebviewWindow};

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
    toggle_window(&window)
}

/// The toggle itself, shared with the tray (F1): hide if visible, else show.
pub fn toggle_window(window: &WebviewWindow) -> Result<(), String> {
    let visible = window.is_visible().map_err(|e| e.to_string())?;
    if visible {
        window.hide().map_err(|e| e.to_string())
    } else {
        window.show().map_err(|e| e.to_string())
    }
}

/// Toggle the HUD from outside a command (tray menu / left click).
pub fn toggle_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(crate::MAIN_WINDOW_LABEL)
        .ok_or_else(|| "HUD window not found".to_string())?;
    toggle_window(&window)
}

/// Reads the window's actual OS-level visibility. The read-then-act counterpart
/// to `overlay_toggle` for callers that must know the state before acting (the
/// hotkey captures only when about to show) — same native source of truth.
#[tauri::command]
pub fn overlay_is_visible(window: WebviewWindow) -> Result<bool, String> {
    window.is_visible().map_err(|e| e.to_string())
}
