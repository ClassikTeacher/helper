//! Audio → STT commands (phase 9). Thin adapters over the `AudioRecorder` port
//! and `SttClient`. Secure-native, same shape as `llm_stream`: recording runs
//! in native, the recorded audio never crosses into the webview — only the
//! transcript does. The STT call reuses the existing OpenRouter key (the model
//! is served by OpenRouter), so there is no separate `stt.api_key`.

use tauri::State;

use crate::dto::TranscribeResult;
use crate::infra::audio::samples_to_wav;
use crate::AppState;

/// `SecretStore` key for the OpenRouter API key — reused for STT. MUST match
/// `SECRET_KEYS.openRouterApiKey` (secrets.port.ts) and the copy in
/// `commands/llm.rs`; there is no shared enum across the Rust/TS seam.
const OPENROUTER_API_KEY_SECRET: &str = "openrouter.api_key";

/// Start capturing loopback audio (the output device / interlocutor's voice).
#[tauri::command]
pub fn audio_start_capture(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.start()
}

/// Stop capturing. Buffered audio is retained for the next `transcribe_audio`.
#[tauri::command]
pub fn audio_stop_capture(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.stop()
}

/// Drain the captured audio, encode it as a 16 kHz mono WAV, and transcribe it
/// via OpenRouter. Returns an empty transcript when nothing was captured (e.g.
/// the user toggled recording off, or the output was silent) — that is not an
/// error, it just means there is no audio context to attach.
#[tauri::command]
pub async fn transcribe_audio(state: State<'_, AppState>) -> Result<TranscribeResult, String> {
    let recorded = state.audio.take_audio()?;
    if recorded.samples.is_empty() {
        return Ok(TranscribeResult {
            text: String::new(),
        });
    }

    let wav = samples_to_wav(&recorded.samples, recorded.sample_rate, recorded.channels);

    let api_key = match state.secrets.get(OPENROUTER_API_KEY_SECRET)? {
        Some(key) if !key.trim().is_empty() => key,
        _ => return Err("OpenRouter API key is not set. Add it in settings.".to_string()),
    };

    let text = state.stt.transcribe(&api_key, wav).await?;
    Ok(TranscribeResult { text })
}
