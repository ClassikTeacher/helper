//! Composition root for the Rust core. Wires concrete implementations into
//! services (DI) and registers them + commands with Tauri. This is the only
//! place that names concrete infra types.

pub mod commands;
pub mod dto;
pub mod infra;
pub mod ports;
pub mod services;

use tauri::Manager;

use ports::{OcrEngine, SecretStore};
use services::capture_service::CaptureService;

/// Application state injected into command handlers via `tauri::State`.
pub struct AppState {
    pub capture: CaptureService,
    pub ocr: Box<dyn OcrEngine>,
    pub secrets: Box<dyn SecretStore>,
}

impl AppState {
    /// Build the default production wiring. Swap any impl here (or in tests).
    fn build_default() -> Self {
        AppState {
            capture: CaptureService::new(Box::new(infra::scap_capturer::ScapCapturer::new())),
            ocr: Box::new(infra::ort_ocr::OrtOcr::new()),
            secrets: Box::new(infra::keyring_secrets::KeyringSecrets::new()),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance guard: without it, a second launch spawns a second
    // process that also tries to register the SAME global hotkey. Its
    // registration fails (own overlay HUD would then wrongly force itself
    // visible via the hotkey-error fallback, see ServicesProvider.tsx),
    // leaving multiple overlapping overlay windows stacked on screen where
    // toggling one is invisible behind the others. Must be the FIRST plugin
    // registered (Tauri requirement) and is desktop-only.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(AppState::build_default())
        .invoke_handler(tauri::generate_handler![
            commands::capture::capture_screen,
            commands::ocr::ocr_image,
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::overlay_show,
            commands::overlay_hide,
            commands::overlay_toggle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
