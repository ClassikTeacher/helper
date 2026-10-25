//! Composition root for the Rust core. Wires concrete implementations into
//! services (DI) and registers them + commands with Tauri. This is the only
//! place that names concrete infra types.

pub mod commands;
pub mod dto;
pub mod infra;
pub mod ports;
pub mod services;

#[cfg(test)]
mod contract_fixtures;

use std::sync::Arc;

use tauri::{Manager, Url, WebviewWindowBuilder};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

use infra::openrouter_client::OpenRouterClient;
use infra::stt_client::SttClient;
use infra::wasapi_loopback::WasapiLoopbackRecorder;
use ports::{AudioRecorder, OcrEngine, SecretStore};
use services::capture_service::CaptureService;

/// Label of the HUD window (`app.windows[].label` in tauri.conf.json).
const MAIN_WINDOW_LABEL: &str = "main";

/// Native log file (`<app_log_dir>/<stem>.log`, written by `tauri-plugin-log`).
/// `diagnostics_snapshot` reads its tail.
///
/// LOGGING POLICY (2026-10 review §5.5): the log is meant to be pasted into a
/// bug report, so it records *what happened*, never *what was said or shown*:
/// command names, sizes, durations, model slugs, finish reasons, error
/// messages — and never the API key, prompt text, screenshots, code text or
/// transcripts (only their lengths).
pub const LOG_FILE_STEM: &str = "ai-helper";

/// Keep the log file small enough to paste: rotate at ~1 MB, keep one backup.
const LOG_MAX_FILE_SIZE: u128 = 1_000_000;

/// Application state injected into command handlers via `tauri::State`.
pub struct AppState {
    pub capture: CaptureService,
    /// `Arc` so `ocr_image` can run it on a blocking thread (it takes ~1 s).
    pub ocr: Arc<dyn OcrEngine>,
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
            ocr: Arc::new(infra::ort_ocr::OrtOcr::new()),
            secrets: Box::new(infra::keyring_secrets::KeyringSecrets::new()),
            llm: OpenRouterClient::new(),
            llm_cancels: infra::llm_cancel::CancelRegistry::new(),
            audio: Box::new(WasapiLoopbackRecorder::new()),
            stt: SttClient::new(),
        }
    }
}

/// Navigation allow-list for the HUD webview (2026-10 review §2.5). Model
/// output is untrusted: a link planted through the screenshot or the
/// transcript must not be able to turn the frameless overlay into a browser
/// pointed at an attacker's page. The webview already renders links as inert
/// text (`MarkdownMessage`); this is the native backstop for any other way a
/// navigation could be triggered. Only the app's own origins may load: the
/// bundled frontend (`tauri://localhost` on macOS/Linux, `http(s)://tauri.localhost`
/// on Windows), `about:blank` (wry's initial page) and — in dev builds only —
/// the Vite dev server (`build.devUrl`). Pure, unit-tested.
pub fn is_allowed_navigation(url: &Url, dev_url: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| {
                    dev.scheme() == url.scheme()
                        && dev.host_str() == url.host_str()
                        && dev.port_or_known_default() == url.port_or_known_default()
                })
        }
        _ => false,
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
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    // No `tauri-plugin-sql`: the SQLite dialog history was removed (2026-10
    // review §2.4) — dialogs are in-memory only and nothing is written to disk.
    builder
        // Logging first, so the other plugins' own log lines are captured too.
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some(LOG_FILE_STEM.to_string()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                .max_file_size(LOG_MAX_FILE_SIZE)
                .rotation_strategy(RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        // R15: the paste-code hotkey reads the clipboard natively (a global
        // hotkey has no user gesture, so the webview Clipboard API can't).
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(AppState::build_default())
        .setup(|app| {
            // The HUD window is declared in tauri.conf.json (single source of
            // truth for its geometry/flags) with `create: false`, and built
            // here from that same config: a navigation handler can only be
            // attached at creation time, and there is no Builder-level hook.
            let config = app.config();
            let window_config = config
                .app
                .windows
                .iter()
                .find(|w| w.label == MAIN_WINDOW_LABEL)
                .ok_or_else(|| format!("window `{MAIN_WINDOW_LABEL}` is missing from tauri.conf.json"))?;
            let dev_url = if tauri::is_dev() { config.build.dev_url.clone() } else { None };
            WebviewWindowBuilder::from_config(app.handle(), window_config)?
                .on_navigation(move |url| {
                    let allowed = is_allowed_navigation(url, dev_url.as_ref());
                    if !allowed {
                        log::warn!("overlay: blocked navigation to {url}");
                    }
                    allowed
                })
                .build()?;
            log::info!(
                "started v{} ({} {})",
                app.package_info().version,
                std::env::consts::OS,
                std::env::consts::ARCH
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture::capture_screen,
            commands::ocr::ocr_image,
            commands::llm::llm_stream,
            commands::llm::llm_cancel,
            // Write-only secret access: the webview can ask "is it set?", set
            // and delete — never read a value (architecture.md §11).
            commands::secrets::secret_has,
            commands::secrets::secret_set,
            commands::secrets::secret_delete,
            commands::audio::audio_start_capture,
            commands::audio::audio_stop_capture,
            commands::audio::transcribe_audio,
            commands::overlay_show,
            commands::overlay_hide,
            commands::overlay_toggle,
            commands::overlay_is_visible,
            commands::diagnostics::diagnostics_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn navigation_allows_the_bundled_frontend_origins() {
        for s in [
            "tauri://localhost/index.html",
            "http://tauri.localhost/",
            "https://tauri.localhost/assets/index-abc.js",
            "about:blank",
        ] {
            assert!(is_allowed_navigation(&url(s), None), "{s}");
        }
    }

    #[test]
    fn navigation_allows_the_dev_server_only_when_a_dev_url_is_given() {
        let dev = url("http://localhost:1420");
        assert!(is_allowed_navigation(&url("http://localhost:1420/"), Some(&dev)));
        assert!(is_allowed_navigation(&url("http://localhost:1420/src/main.tsx"), Some(&dev)));
        // Release builds pass no dev URL: localhost is then just another host.
        assert!(!is_allowed_navigation(&url("http://localhost:1420/"), None));
        // Same host, other port/scheme: not the dev server.
        assert!(!is_allowed_navigation(&url("http://localhost:1421/"), Some(&dev)));
        assert!(!is_allowed_navigation(&url("https://localhost:1420/"), Some(&dev)));
    }

    #[test]
    fn navigation_blocks_everything_else() {
        let dev = url("http://localhost:1420");
        for s in [
            "https://evil.example/login",
            "http://tauri.localhost.evil.example/",
            "https://openrouter.ai/",
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "data:text/html,hi",
            "ipc://localhost/",
        ] {
            assert!(!is_allowed_navigation(&url(s), Some(&dev)), "{s}");
        }
    }
}
