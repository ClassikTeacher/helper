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

/// Default language hint. Speech is mixed but mostly Russian (user,
/// 2026-07-21); `ru` biases decoding toward Russian without hard-failing on
/// English segments. Override via `AI_HELPER_STT_LANGUAGE` (`auto` = let the
/// model detect the language — no hint sent).
pub const STT_LANGUAGE: &str = "ru";
const STT_LANGUAGE_ENV: &str = "AI_HELPER_STT_LANGUAGE";

/// Vocabulary hint (Whisper `prompt`, P1): Whisper conditions on the prompt as
/// if it were preceding speech, so listing the domain's terms — in the script
/// they should come out in — stops "горутина"/"mutex"/"Kafka" being heard as
/// ordinary words. Kept well under Whisper's 224-token prompt limit. Override
/// via `AI_HELPER_STT_PROMPT` (`off` = no prompt).
pub const DEFAULT_STT_PROMPT: &str = "Техническое собеседование по программированию. \
Go, горутина, канал, мьютекс, RWMutex, map, slice, defer, context, интерфейс, \
Python, JavaScript, TypeScript, React, Java, Kotlin, C#, SQL, JOIN, индекс, транзакция, \
PostgreSQL, Redis, Kafka, Docker, Kubernetes, HTTP, REST, gRPC, API, \
O(n), хеш-таблица, бинарный поиск, связный список, LeetCode.";
const STT_PROMPT_ENV: &str = "AI_HELPER_STT_PROMPT";

/// An env override: unset/blank → `default`; the `disable` word → `None`;
/// anything else → that value.
fn resolve_override(raw: Option<&str>, disable: &str, default: &str) -> Option<String> {
    match raw.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) if v.eq_ignore_ascii_case(disable) => None,
        Some(v) => Some(v.to_string()),
        None => Some(default.to_string()),
    }
}

/// Language hint to send: the override, `None` for `auto`, else the default.
fn resolve_language(raw: Option<&str>) -> Option<String> {
    resolve_override(raw, "auto", STT_LANGUAGE)
}

/// Vocabulary prompt to send: the override, `None` for `off`, else the default.
fn resolve_prompt(raw: Option<&str>) -> Option<String> {
    resolve_override(raw, "off", DEFAULT_STT_PROMPT)
}

/// The text fields of the multipart form (besides `file`). Pure — unit-tested.
fn form_fields(language: Option<&str>, prompt: Option<&str>) -> Vec<(&'static str, String)> {
    let mut fields = vec![("model", STT_MODEL.to_string())];
    if let Some(language) = language {
        fields.push(("language", language.to_string()));
    }
    if let Some(prompt) = prompt {
        fields.push(("prompt", prompt.to_string()));
    }
    fields.push(("response_format", "json".to_string()));
    fields
}

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
    /// The request itself was rejected (400/422). Permanent as sent — but if a
    /// vocabulary prompt was included, the endpoint may just not accept that
    /// field, so `transcribe` retries once without it.
    Rejected(String),
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
        let language = resolve_language(std::env::var(STT_LANGUAGE_ENV).ok().as_deref());
        let mut prompt = resolve_prompt(std::env::var(STT_PROMPT_ENV).ok().as_deref());
        let mut last_err = String::from("STT made no attempts");
        let mut attempts = 0;
        while attempts < STT_MAX_ATTEMPTS {
            attempts += 1;
            let fields = form_fields(language.as_deref(), prompt.as_deref());
            match self.transcribe_once(api_key, wav.clone(), fields).await {
                Outcome::Done(text) => return Ok(text),
                Outcome::Retry(err) => last_err = err, // drop this request, retry
                // The vocabulary prompt is an optional nicety: if the request was
                // rejected with it, drop it and try again rather than lose the audio.
                Outcome::Rejected(err) if prompt.is_some() => {
                    prompt = None;
                    last_err = err;
                    attempts -= 1; // the prompt-less retry does not count
                }
                Outcome::Rejected(err) | Outcome::Fatal(err) => return Err(err),
            }
        }
        Err(format!(
            "STT failed after {STT_MAX_ATTEMPTS} attempts: {last_err}"
        ))
    }

    /// One transcription attempt. Classifies the result so `transcribe` knows
    /// whether to retry. Timeouts and network errors are transient; the response
    /// body is only read for a permanent, human-readable HTTP error message.
    async fn transcribe_once(
        &self,
        api_key: &str,
        wav: Vec<u8>,
        fields: Vec<(&'static str, String)>,
    ) -> Outcome {
        let file_part = match reqwest::multipart::Part::bytes(wav)
            .file_name("audio.wav")
            .mime_str("audio/wav")
        {
            Ok(part) => part,
            Err(e) => return Outcome::Fatal(format!("Failed to build audio upload part: {e}")),
        };

        let form = fields
            .into_iter()
            .fold(reqwest::multipart::Form::new().part("file", file_part), |form, (k, v)| {
                form.text(k, v)
            });

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
            } else if matches!(status.as_u16(), 400 | 422) {
                Outcome::Rejected(msg)
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

    #[test]
    fn language_defaults_to_ru_and_auto_sends_none() {
        assert_eq!(resolve_language(None).as_deref(), Some("ru"));
        assert_eq!(resolve_language(Some(" en ")).as_deref(), Some("en"));
        assert_eq!(resolve_language(Some("AUTO")), None);
    }

    #[test]
    fn prompt_defaults_to_the_vocabulary_and_off_disables_it() {
        assert_eq!(resolve_prompt(None).as_deref(), Some(DEFAULT_STT_PROMPT));
        assert_eq!(resolve_prompt(Some("off")), None);
        assert_eq!(resolve_prompt(Some("Rust, borrow checker")).as_deref(), Some("Rust, borrow checker"));
        // Whisper's prompt limit is 224 tokens; stay far below it.
        assert!(DEFAULT_STT_PROMPT.chars().count() < 500);
    }

    #[test]
    fn form_fields_include_only_what_is_set() {
        let all = form_fields(Some("ru"), Some("vocab"));
        let names: Vec<_> = all.iter().map(|(k, _)| *k).collect();
        assert_eq!(names, ["model", "language", "prompt", "response_format"]);

        let bare = form_fields(None, None);
        let names: Vec<_> = bare.iter().map(|(k, _)| *k).collect();
        assert_eq!(names, ["model", "response_format"]);
    }
}
