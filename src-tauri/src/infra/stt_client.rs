//! `SttClient` — production impl of the secure-native speech-to-text call
//! (phase 9). Uploads the recorded loopback WAV to OpenRouter's OpenAI-compatible
//! transcription endpoint and returns the recognized text. Mirrors the
//! secure-native shape of `openrouter_client.rs`: the API key stays in native
//! (read from the keychain by `commands/audio.rs`, same `openrouter.api_key` as
//! LLM streaming) and the audio never crosses into the webview.
//!
//! Endpoint + slug were verified before implementation (see decisions.md ADR #14
//! phase-9 de-risk notes): `POST /api/v1/audio/transcriptions` accepts an
//! OpenAI-style multipart form (`file`/`model`/`language`/`response_format`) and
//! returns `{ "text": ..., "usage": {...} }`.

use std::time::Duration;

const OPENROUTER_TRANSCRIPTIONS_URL: &str = "https://openrouter.ai/api/v1/audio/transcriptions";

/// OpenRouter slug for the STT model (user's choice, 2026-07-21). Confirmed
/// present in `GET /api/v1/models?output_modalities=transcription`.
pub const STT_MODEL: &str = "openai/whisper-large-v3-turbo";

/// Language hint sent to the model. Speech is mixed but mostly Russian
/// (user, 2026-07-21); `ru` biases decoding toward Russian without hard-failing
/// on English segments.
pub const STT_LANGUAGE: &str = "ru";

/// Per-attempt timeout. Whisper-turbo transcribes a ≤60 s clip in a couple of
/// seconds, so a request still outstanding after this long is almost certainly
/// stuck (slow/hung connection) — response latency matters more than saving the
/// in-flight call, so we abort it (drop the future) and fire a fresh one.
/// Overridable via `AI_HELPER_STT_TIMEOUT_MS`.
const DEFAULT_STT_TIMEOUT_MS: u64 = 8_000;

/// Environment variable overriding [`DEFAULT_STT_TIMEOUT_MS`] (milliseconds).
const STT_TIMEOUT_ENV: &str = "AI_HELPER_STT_TIMEOUT_MS";

/// Total attempts before giving up (the first try plus retries). Transcription
/// is idempotent (no side effects), so retrying is safe.
const STT_MAX_ATTEMPTS: u32 = 3;

/// Parse the per-attempt timeout override, falling back to the default on an
/// absent/blank/invalid/zero value. Pure so it is unit-tested directly.
fn resolve_timeout_ms(raw: Option<&str>) -> u64 {
    raw.and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|&v| v > 0)
        .unwrap_or(DEFAULT_STT_TIMEOUT_MS)
}

/// Configured per-attempt timeout (env override or default).
fn stt_timeout() -> Duration {
    Duration::from_millis(resolve_timeout_ms(
        std::env::var(STT_TIMEOUT_ENV).ok().as_deref(),
    ))
}

/// Whether an HTTP status is worth retrying with a fresh request. Mirrors
/// `openrouter_client::is_transient_status`: all 5xx plus a few transient 4xx
/// (408 timeout, 409 conflict, 425 too-early, 429 rate-limit); other 4xx (auth,
/// bad request) are permanent and must not be retried.
fn is_retryable_status(status: u16) -> bool {
    matches!(status, 408 | 409 | 425 | 429) || (500..=599).contains(&status)
}

/// Outcome of a single transcription attempt, telling the retry loop whether to
/// try again.
enum Outcome {
    /// Success — the recognized transcript.
    Done(String),
    /// Transient failure (timeout, network, retryable HTTP) — try again.
    Retry(String),
    /// Permanent failure (auth, bad request, malformed response) — stop.
    Fatal(String),
}

pub struct SttClient {
    http: reqwest::Client,
}

impl SttClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
        }
    }

    /// Transcribes `wav` (16 kHz mono PCM16, produced by `infra::audio`). Returns
    /// the recognized text, or a human-readable error string on any failure
    /// (network, HTTP status, malformed body) — the caller turns that into a
    /// command rejection surfaced in the HUD.
    ///
    /// Each attempt has a timeout ([`stt_timeout`]); if it fires — or the attempt
    /// hits a transient error — the in-flight request is dropped (aborted) and a
    /// fresh one is sent, up to [`STT_MAX_ATTEMPTS`]. A permanent error (auth,
    /// bad request, malformed body) stops immediately. `wav` is cloned per
    /// attempt (~≤2 MB at the 60 s cap), which is cheap relative to the upload.
    pub async fn transcribe(&self, api_key: &str, wav: Vec<u8>) -> Result<String, String> {
        let mut last_err = String::from("STT made no attempts");
        for _ in 0..STT_MAX_ATTEMPTS {
            match self.transcribe_once(api_key, wav.clone()).await {
                Outcome::Done(text) => return Ok(text),
                Outcome::Retry(err) => last_err = err, // drop this request, retry
                Outcome::Fatal(err) => return Err(err),
            }
        }
        Err(format!(
            "STT failed after {STT_MAX_ATTEMPTS} attempts: {last_err}"
        ))
    }

    /// One transcription attempt. Classifies the result so `transcribe` knows
    /// whether to retry. Timeouts and network errors are transient; the response
    /// body is only read for a permanent, human-readable HTTP error message.
    async fn transcribe_once(&self, api_key: &str, wav: Vec<u8>) -> Outcome {
        let file_part = match reqwest::multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")
        {
            Ok(part) => part,
            Err(e) => return Outcome::Fatal(format!("Failed to build audio upload part: {e}")),
        };

        let form = reqwest::multipart::Form::new()
            .part("file", file_part)
            .text("model", STT_MODEL)
            .text("language", STT_LANGUAGE)
            .text("response_format", "json");

        let response = match self
            .http
            .post(OPENROUTER_TRANSCRIPTIONS_URL)
            .bearer_auth(api_key)
            .multipart(form)
            .timeout(stt_timeout())
            .send()
            .await
        {
            Ok(response) => response,
            // Timeout / connection / other transport error — abort and retry.
            Err(e) => return Outcome::Retry(format!("STT request failed: {e}")),
        };

        let status = response.status();
        if !status.is_success() {
            let text = response.text().await.unwrap_or_default();
            let msg = format!("STT HTTP {status}: {text}");
            return if is_retryable_status(status.as_u16()) {
                Outcome::Retry(msg)
            } else {
                Outcome::Fatal(msg)
            };
        }

        let body = match response.text().await {
            Ok(body) => body,
            Err(e) => return Outcome::Retry(format!("Failed to read STT response: {e}")),
        };

        match parse_transcription_text(&body) {
            Ok(text) => Outcome::Done(text),
            Err(e) => Outcome::Fatal(e),
        }
    }
}

impl Default for SttClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Extracts the `text` field from a transcription response body. Pure and
/// network-free so it is unit-tested directly (same pattern as
/// `openrouter_client::parse_sse_event`).
fn parse_transcription_text(body: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|e| format!("STT response was not JSON: {e}"))?;

    match value["text"].as_str() {
        Some(text) => Ok(text.trim().to_string()),
        None => Err(format!("STT response missing `text` field: {body}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_text_from_a_well_formed_response() {
        let body = r#"{"text":"привет мир","usage":{"seconds":9.2}}"#;
        assert_eq!(parse_transcription_text(body).unwrap(), "привет мир");
    }

    #[test]
    fn trims_surrounding_whitespace_from_transcript() {
        let body = r#"{"text":"  hello  "}"#;
        assert_eq!(parse_transcription_text(body).unwrap(), "hello");
    }

    #[test]
    fn errors_when_text_field_is_absent() {
        let body = r#"{"error":"bad model"}"#;
        assert!(parse_transcription_text(body).is_err());
    }

    #[test]
    fn errors_when_body_is_not_json() {
        assert!(parse_transcription_text("not json at all").is_err());
    }

    #[test]
    fn resolve_timeout_ms_uses_the_override_when_valid() {
        assert_eq!(resolve_timeout_ms(Some("3000")), 3000);
        assert_eq!(resolve_timeout_ms(Some("  1500 ")), 1500);
    }

    #[test]
    fn resolve_timeout_ms_falls_back_on_absent_blank_invalid_or_zero() {
        assert_eq!(resolve_timeout_ms(None), DEFAULT_STT_TIMEOUT_MS);
        assert_eq!(resolve_timeout_ms(Some("")), DEFAULT_STT_TIMEOUT_MS);
        assert_eq!(resolve_timeout_ms(Some("soon")), DEFAULT_STT_TIMEOUT_MS);
        assert_eq!(resolve_timeout_ms(Some("0")), DEFAULT_STT_TIMEOUT_MS);
    }

    #[test]
    fn retryable_statuses_are_5xx_and_transient_4xx_only() {
        // Transient → retry.
        for s in [408, 409, 425, 429, 500, 502, 503, 504] {
            assert!(is_retryable_status(s), "{s} should be retryable");
        }
        // Permanent → do not retry.
        for s in [400, 401, 403, 404, 422, 200] {
            assert!(!is_retryable_status(s), "{s} should NOT be retryable");
        }
    }
}
