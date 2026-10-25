//! Audio → STT commands (phase 9). Thin adapters over the `AudioRecorder` port
//! and `SttClient`. Secure-native, same shape as `llm_stream`: recording runs
//! in native, the recorded audio never crosses into the webview — only the
//! transcript does. The STT call reuses the existing OpenRouter key (the model
//! is served by OpenRouter), so there is no separate `stt.api_key`.

use tauri::State;

use crate::commands::secrets::OPENROUTER_API_KEY_SECRET;
use crate::dto::{AudioStartResult, TranscribeResult};
use crate::infra::audio::{prepare_stt_audio, silence_threshold_from_env};
use crate::AppState;

/// Start capturing loopback audio (the output device / interlocutor's voice).
/// Reports the rolling window the recording keeps (the last N seconds).
///
/// `async` (here and on `audio_stop_capture`): sync commands run on the main
/// thread; `start` joins a leftover capture thread and `stop` always joins it
/// (up to the 200 ms event timeout), which would stall the event loop
/// (2026-10 review §3.4).
#[tauri::command(async)]
pub fn audio_start_capture(state: State<'_, AppState>) -> Result<AudioStartResult, String> {
    state.audio.start()?;
    Ok(AudioStartResult {
        max_seconds: crate::infra::wasapi_loopback::max_recording_secs(),
    })
}

/// Stop capturing. Buffered audio is retained for the next `transcribe_audio`.
#[tauri::command(async)]
pub fn audio_stop_capture(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.stop()
}

/// Drain the captured audio, gate/trim its silence, encode it as a 16 kHz mono
/// WAV, and transcribe it via OpenRouter. Returns an empty transcript when
/// there is nothing to transcribe — nothing captured, the clip is silent
/// (2026-10 review §3.2), or STT returned a known hallucination — that is not
/// an error, it just means there is no audio context to attach.
#[tauri::command]
pub async fn transcribe_audio(state: State<'_, AppState>) -> Result<TranscribeResult, String> {
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

    let Some(wav) = prepare_stt_audio(
        &recorded.samples,
        recorded.sample_rate,
        recorded.channels,
        silence_threshold_from_env(),
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
    let text = state.stt.transcribe(&api_key, wav).await?;
    Ok(TranscribeResult { text })
}
