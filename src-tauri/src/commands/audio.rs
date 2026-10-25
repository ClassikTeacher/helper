//! Audio → STT commands (phase 9). Thin adapters over the `AudioRecorder` port
//! and `SttClient`. Secure-native, same shape as `llm_stream`: recording runs
//! in native, the recorded audio never crosses into the webview — only the
//! transcript does. The STT call reuses the existing OpenRouter key (the model
//! is served by OpenRouter), so there is no separate `stt.api_key`.

use tauri::{AppHandle, State};

use crate::commands::secrets::OPENROUTER_API_KEY_SECRET;
use crate::dto::{AudioStartRequest, AudioStartResult, TranscribeRequest, TranscribeResult};
use crate::infra::audio::{prepare_stt_audio, resolve_silence_threshold_with, silence_threshold_env_raw};
use crate::infra::stt_client::SttOptions;
use crate::infra::wasapi_loopback::{resolve_window_secs, MAX_RECORDING_SECS_ENV};
use crate::AppState;

/// Start capturing loopback audio (the output device / interlocutor's voice).
/// Reports the rolling window the recording keeps (the last N seconds).
///
/// `async` (here and on `audio_stop_capture`): sync commands run on the main
/// thread; `start` joins a leftover capture thread and `stop` always joins it
/// (up to the 200 ms event timeout), which would stall the event loop
/// (2026-10 review §3.4).
#[tauri::command(async)]
pub fn audio_start_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Option<AudioStartRequest>,
) -> Result<AudioStartResult, String> {
    let window_secs = recording_window_secs(request.as_ref().and_then(|r| r.window_secs));
    state.audio.start(window_secs)?;
    // The tray indicator follows the recorder, not the webview (F1).
    crate::tray::set_recording(&app, true);
    log::info!("audio_start_capture: rolling window {window_secs} s");
    Ok(AudioStartResult {
        max_seconds: window_secs,
    })
}

/// Env (`AI_HELPER_MAX_RECORDING_SECS`) wins, then the settings screen's
/// value carried by the request (F2), then the default.
fn recording_window_secs(requested: Option<u32>) -> u32 {
    resolve_window_secs(std::env::var(MAX_RECORDING_SECS_ENV).ok().as_deref(), requested)
}

/// Stop capturing. Buffered audio is retained for the next `transcribe_audio`.
#[tauri::command(async)]
pub fn audio_stop_capture(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let result = state.audio.stop();
    crate::tray::set_recording(&app, false);
    result
}

/// Drain the captured audio, gate/trim its silence, encode it as a 16 kHz mono
/// WAV, and transcribe it via OpenRouter. Returns an empty transcript when
/// there is nothing to transcribe — nothing captured, the clip is silent
/// (2026-10 review §3.2), or STT returned a known hallucination — that is not
/// an error, it just means there is no audio context to attach.
#[tauri::command]
pub async fn transcribe_audio(
    state: State<'_, AppState>,
    request: Option<TranscribeRequest>,
) -> Result<TranscribeResult, String> {
    let request = request.unwrap_or_default();
    // The key is checked BEFORE the buffer is drained: with no key the audio
    // stays recorded instead of being thrown away with the error.
    let api_key = match state.secrets.get(OPENROUTER_API_KEY_SECRET)? {
        Some(key) if !key.trim().is_empty() => key,
        _ => return Err("OpenRouter API key is not set. Add it in settings.".to_string()),
    };

    let recorded = state.audio.take_audio()?;
    let secs = recorded.samples.len() as f32 / (recorded.sample_rate.max(1) as f32 * recorded.channels.max(1) as f32);
    if recorded.samples.is_empty() {
        log::info!("transcribe_audio: nothing captured");
        return Ok(TranscribeResult {
            text: String::new(),
        });
    }

    // Gate level: env override > settings (request) > default (F2).
    let threshold = resolve_silence_threshold_with(
        silence_threshold_env_raw().as_deref(),
        request.silence_gate,
        request.silence_dbfs,
    );
    let Some(wav) = prepare_stt_audio(
        &recorded.samples,
        recorded.sample_rate,
        recorded.channels,
        threshold,
    ) else {
        // Silent clip: no upload, no hallucinated "question".
        log::info!("transcribe_audio: {secs:.1} s captured, silent under the gate — not uploaded");
        return Ok(TranscribeResult {
            text: String::new(),
        });
    };

    log::info!(
        "transcribe_audio: {secs:.1} s captured @{} Hz x{}, {} KB after gate/trim",
        recorded.sample_rate,
        recorded.channels,
        wav.len() / 1024
    );
    let options = SttOptions::resolve(request.language.as_deref(), request.prompt.as_deref());
    let text = state.stt.transcribe(&api_key, wav, options).await?;
    Ok(TranscribeResult { text })
}
