//! Composition root for the Rust core. Wires concrete implementations into
//! services (DI) and registers them + commands with Tauri. This is the only
//! place that names concrete infra types.

pub mod commands;
pub mod dto;
pub mod infra;
pub mod ports;
pub mod services;

use tauri::Manager;

use infra::openrouter_client::OpenRouterClient;
use infra::stt_client::SttClient;
use infra::wasapi_loopback::WasapiLoopbackRecorder;
use ports::{AudioRecorder, OcrEngine, SecretStore};
use services::capture_service::CaptureService;

/// Application state injected into command handlers via `tauri::State`.
pub struct AppState {
    pub capture: CaptureService,
    pub ocr: Box<dyn OcrEngine>,
    pub secrets: Box<dyn SecretStore>,
    /// No trait/fake here (unlike `ocr`/`secrets`): `OpenRouterClient`'s HTTP
    /// call has nothing worth faking behind a trait — its actual logic (SSE
    /// framing, request-body shape) is pure functions already covered by unit
    /// tests in `infra::openrouter_client::tests` (architecture.md §6: traits
    /// only when a fake is actually needed).
    pub llm: OpenRouterClient,
    /// In-flight `llm_stream` requests that `llm_cancel` can stop.
    pub llm_cancels: infra::llm_cancel::CancelRegistry,
    /// Loopback audio recorder (phase 9). Behind a trait so tests/non-Windows
    /// can swap it; the real impl is WASAPI-only.
    pub audio: Box<dyn AudioRecorder>,
    /// STT client (phase 9) — same rationale as `llm` for having no fake trait:
    /// its logic (multipart shape, response parse) is pure and unit-tested in
    /// `infra::stt_client::tests`.
    pub stt: SttClient,
}

impl AppState {
    /// Build the default production wiring. Swap any impl here (or in tests).
    fn build_default() -> Self {
        AppState {
            capture: CaptureService::new(Box::new(infra::scap_capturer::ScapCapturer::new())),
            ocr: Box::new(infra::ort_ocr::OrtOcr::new()),
            secrets: Box::new(infra::keyring_secrets::KeyringSecrets::new()),
            llm: OpenRouterClient::new(),
            llm_cancels: infra::llm_cancel::CancelRegistry::new(),
            audio: Box::new(WasapiLoopbackRecorder::new()),
            stt: SttClient::new(),
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
        // R15: the paste-code hotkey reads the clipboard natively (a global
        // hotkey has no user gesture, so the webview Clipboard API can't).
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::build_default())
        .invoke_handler(tauri::generate_handler![
            commands::capture::capture_screen,
            commands::ocr::ocr_image,
            commands::llm::llm_stream,
            commands::llm::llm_cancel,
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::audio::audio_start_capture,
            commands::audio::audio_stop_capture,
            commands::audio::transcribe_audio,
            commands::overlay_show,
            commands::overlay_hide,
            commands::overlay_toggle,
            commands::overlay_is_visible,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
