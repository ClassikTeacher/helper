//! `OpenRouterClient` — production impl of the secure-native LLM streaming
//! HTTP call (phase 2). Ported from `examples/spike_llm_stream.rs` (phase
//! 0.5), which already validated the full mechanism (reqwest SSE ->
//! `tauri::ipc::Channel`) against a live OpenRouter call — see decisions.md
//! "Спайк llm_stream". Differences from the spike: reads the key from
//! `SecretStore` instead of env (handled by the caller, `commands/llm.rs`),
//! and every failure path (HTTP error, network error, malformed stream) is
//! delivered as a terminal `LlmChunk::Error` instead of a process exit.

use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::dto::{LlmChunk, LlmContentPart, LlmMessage, LlmRole, LlmStreamRequest, LlmUsage};

const OPENROUTER_CHAT_COMPLETIONS_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

pub struct OpenRouterClient {
    http: reqwest::Client,
}

impl OpenRouterClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
        }
    }

    /// Streams a chat completion from OpenRouter, sending every chunk over
    /// `channel`. Never returns an error: the wire contract (architecture.md
    /// §11) makes the channel the single source of truth for both success and
    /// failure (`text-delta*` -> terminal `finish` OR `error`), so
    /// `TauriLlmAdapter` can treat every terminal outcome uniformly instead of
    /// juggling a command `Result` on top of the channel.
    pub async fn stream_chat(
        &self,
        api_key: &str,
        request: &LlmStreamRequest,
        channel: &Channel<LlmChunk>,
    ) {
        let body = build_request_body(request);

        let response = match self
            .http
            .post(OPENROUTER_CHAT_COMPLETIONS_URL)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(e) => {
                // Network/transport failure reaching OpenRouter — transient, so
                // another model (or a retry) may well succeed: retryable.
                send_error(channel, format!("OpenRouter request failed: {e}"), true);
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            let retryable = is_transient_status(status.as_u16());
            send_error(channel, format!("OpenRouter HTTP {status}: {text}"), retryable);
            return;
        }

        // Raw bytes, NOT `String` — a multi-byte UTF-8 codepoint (e.g. Cyrillic,
        // emoji) can legitimately land split across two TCP/HTTP chunks.
        // Lossy-decoding each incoming chunk independently (the earlier
        // approach) would turn the split codepoint into mojibake on both
        // sides of the cut; accumulating raw bytes and decoding only once a
        // complete `\n\n`-delimited event has arrived (see `drain_sse_events`)
        // sidesteps that entirely, since the split can only ever fall inside
        // the "partial tail" that hasn't been decoded yet.
        let mut buf: Vec<u8> = Vec::new();
        let mut stream = response.bytes_stream();
        let mut state = StreamState::default();

        while let Some(item) = stream.next().await {
            let bytes = match item {
                Ok(b) => b,
                Err(e) => {
                    // Transient read failure on the byte stream — retryable.
                    send_error(channel, format!("OpenRouter stream read failed: {e}"), true);
                    return;
                }
            };
            buf.extend_from_slice(&bytes);

            for event in drain_sse_events(&mut buf) {
                let step = state.step(parse_sse_event(&event));
                for chunk in step.chunks {
                    let _ = channel.send(chunk);
                }
                if step.terminal {
                    return;
                }
            }
        }

        // The HTTP body ended without `[DONE]`: a finish seen earlier still
        // completes the stream; otherwise surface the silent stop instead of
        // leaving the webview awaiting a stream that ended. Provider closed the
        // stream without a terminator — a transient provider hiccup: retryable
        // (the webview only fails over if no content was produced).
        let _ = channel.send(state.end_of_body());
    }
}

/// Failover policy: which OpenRouter HTTP statuses are transient / provider-side
/// and thus worth retrying on a DIFFERENT model. All 5xx (server/provider
/// errors) plus 408 (timeout), 409 (conflict), 425 (too early) and 429 (rate
/// limit) are transient; other 4xx (400/401/403/404 — bad request, auth,
/// not-found) would recur on every model and are NOT retryable.
fn is_transient_status(status: u16) -> bool {
    status >= 500 || matches!(status, 408 | 409 | 425 | 429)
}

impl Default for OpenRouterClient {
    fn default() -> Self {
        Self::new()
    }
}

fn send_error(channel: &Channel<LlmChunk>, message: String, retryable: bool) {
    let _ = channel.send(LlmChunk::Error { message, retryable });
}

/// Builds the OpenAI-compatible chat-completions request body. `usage.include`
/// is requested explicitly — OpenRouter omits token/cost accounting otherwise
/// (see decisions.md "Спайк llm_stream": usage came back `null` without it).
///
/// Per-route parameters (R16) are sent ONLY when set:
/// - `temperature` — omitted when `None` (provider default). Models that reject
///   a custom temperature (e.g. with reasoning on Anthropic) get none.
/// - `reasoning` — `{ effort, exclude: true }`: the model thinks before
///   answering, but the thinking is not streamed back — the HUD shows only the
///   answer, and the SSE parser needs no reasoning-delta handling.
///
/// `max_tokens` is deliberately NEVER sent (user decision 2026-07-22): a cap
/// would silently truncate answers; completeness wins. A provider-side length
/// stop is still reported via `finish_reason: "length"` and shown in the HUD.
fn build_request_body(request: &LlmStreamRequest) -> Value {
    let mut body = json!({
        "model": request.model,
        "stream": true,
        "usage": { "include": true },
        "messages": request.messages.iter().map(to_openai_message).collect::<Vec<_>>(),
    });
    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(effort) = &request.reasoning_effort {
        body["reasoning"] = json!({ "effort": effort, "exclude": true });
    }
    body
}

fn to_openai_message(message: &LlmMessage) -> Value {
    // System messages carry a plain-string `content`, not an array of content
    // parts. The OpenAI-compatible array form is only reliably accepted for
    // user/assistant; some providers behind OpenRouter are stricter about the
    // system role (notably the Gemini mapping to `systemInstruction`) and
    // expect a string, so a system prompt sent as an array can be silently
    // dropped on a fallback model. Mirrors the dev adapter
    // (`openrouter-llm.adapter.ts`), which already stringifies system content.
    if matches!(message.role, LlmRole::System) {
        return json!({
            "role": role_str(&message.role),
            "content": system_text(&message.parts),
        });
    }
    json!({
        "role": role_str(&message.role),
        "content": message.parts.iter().map(to_openai_content_part).collect::<Vec<_>>(),
    })
}

/// Joins the text parts of a system message into a single string. System
/// prompts only carry text (never images), so any non-text part is ignored.
fn system_text(parts: &[LlmContentPart]) -> String {
    parts
        .iter()
        .filter_map(|part| match part {
            LlmContentPart::Text { text } => Some(text.as_str()),
            LlmContentPart::Image { .. } => None,
        })
        .collect::<Vec<_>>()
        .join("")
}

fn role_str(role: &LlmRole) -> &'static str {
    match role {
        LlmRole::System => "system",
        LlmRole::User => "user",
        LlmRole::Assistant => "assistant",
    }
}

fn to_openai_content_part(part: &LlmContentPart) -> Value {
    match part {
        LlmContentPart::Text { text } => json!({ "type": "text", "text": text }),
        LlmContentPart::Image { image_base64 } => json!({
            "type": "image_url",
            "image_url": { "url": format!("data:image/png;base64,{image_base64}") },
        }),
    }
}

/// Everything one SSE `data:` JSON chunk can carry. Each field is collected
/// independently because OpenRouter may put the last content delta and the
/// `finish_reason` in the SAME chunk, and sends `usage` (with `cost`) in a
/// LATER chunk than the one carrying `finish_reason` (with empty `choices`).
#[derive(Debug, Default, PartialEq)]
struct SseData {
    delta: Option<String>,
    finish_reason: Option<String>,
    usage: Option<LlmUsage>,
    model: Option<String>,
    /// A mid-stream provider error (`{"error": {...}}` inside the stream).
    error: Option<String>,
}

/// Outcome of parsing a single SSE event block.
#[derive(Debug, PartialEq)]
enum SseOutcome {
    /// Keep-alive comment or an event with no actionable `data:` line.
    None,
    /// `data: [DONE]` — the stream is over.
    Done,
    Data(SseData),
}

/// What the stream loop must do after one event: send these chunks, and stop
/// if `terminal`.
#[derive(Debug, PartialEq)]
struct Step {
    chunks: Vec<LlmChunk>,
    terminal: bool,
}

/// Accumulates the terminal metadata across events so the single `finish`
/// chunk the webview gets carries the reason, usage/cost and serving model
/// together (R9/R19). Pure — unit-tested by feeding event sequences.
#[derive(Debug, Default)]
struct StreamState {
    finish_reason: Option<String>,
    usage: Option<LlmUsage>,
    model: Option<String>,
    /// Whether any text delta was sent — an empty stream is a provider failure.
    produced: bool,
}

impl StreamState {
    fn step(&mut self, outcome: SseOutcome) -> Step {
        match outcome {
            SseOutcome::None => Step { chunks: vec![], terminal: false },
            // `[DONE]` ends the stream. Without a finish_reason it is still a
            // normal end IF content arrived; an EMPTY stream is a provider
            // failure — retryable, so ResilientLlm fails over (it only does so
            // while nothing has been produced) instead of showing a blank answer.
            SseOutcome::Done => Step {
                chunks: vec![self.on_done()],
                terminal: true,
            },
            SseOutcome::Data(data) => {
                if let Some(message) = data.error {
                    // Mid-stream provider error: retryable — ResilientLlm only
                    // fails over when no content has been produced yet.
                    return Step {
                        chunks: vec![LlmChunk::Error { message, retryable: true }],
                        terminal: true,
                    };
                }
                if data.model.is_some() {
                    self.model = data.model;
                }
                if data.usage.is_some() {
                    self.usage = data.usage;
                }
                if data.finish_reason.is_some() {
                    self.finish_reason = data.finish_reason;
                }
                let mut chunks = Vec::new();
                if let Some(delta) = data.delta {
                    self.produced = true;
                    chunks.push(LlmChunk::TextDelta { delta });
                }
                // Usage is the last payload OpenRouter sends: once both the
                // reason and the usage are in, there is nothing left to wait for.
                let terminal = self.finish_reason.is_some() && self.usage.is_some();
                if terminal {
                    chunks.push(self.finish("stop"));
                }
                Step { chunks, terminal }
            }
        }
    }

    /// `[DONE]` arrived: a normal end when a finish_reason or any content came
    /// first; an EMPTY stream is a retryable provider failure.
    fn on_done(&mut self) -> LlmChunk {
        if self.finish_reason.is_some() || self.produced {
            self.finish("stop")
        } else {
            LlmChunk::Error {
                message: "OpenRouter stream ended without any content".to_string(),
                retryable: true,
            }
        }
    }

    /// The HTTP body ended WITHOUT `[DONE]`: complete only if a finish_reason
    /// was seen; otherwise the connection was cut — an error, even after
    /// partial content (the HUD then shows "Interrupted").
    fn end_of_body(&mut self) -> LlmChunk {
        if self.finish_reason.is_some() {
            self.finish("stop")
        } else {
            LlmChunk::Error {
                message: "OpenRouter stream ended without a finish signal".to_string(),
                retryable: true,
            }
        }
    }

    fn finish(&mut self, default_reason: &str) -> LlmChunk {
        LlmChunk::Finish {
            reason: self
                .finish_reason
                .take()
                .unwrap_or_else(|| default_reason.to_string()),
            usage: self.usage.take(),
            model: self.model.take(),
        }
    }
}

/// Splits complete SSE events (`\n\n`-terminated, per the SSE spec) out of an
/// accumulating **byte** buffer, mutating it to keep only the trailing
/// partial event, and UTF-8-decodes each complete event independently.
///
/// Operating on raw bytes (rather than lossy-decoding each network chunk as
/// it arrives) is what makes this UTF-8-safe: `\n\n` is two ASCII bytes
/// (0x0A), which can never appear inside a multi-byte UTF-8 continuation
/// sequence (those are always in the 0x80-0xBF range), so splitting on it at
/// the byte level never bisects a codepoint. Any codepoint actually split
/// across two network chunks simply stays whole-but-unread in the "partial
/// tail" left in `buf` until the rest of its bytes arrive — it's never
/// decoded half-formed.
///
/// Pure and network-free — unit-tested directly, same pattern as
/// `bgra_to_rgba` in `scap_capturer.rs`.
fn drain_sse_events(buf: &mut Vec<u8>) -> Vec<String> {
    let mut events = Vec::new();
    while let Some(pos) = find_double_newline(buf) {
        let event_bytes: Vec<u8> = buf.drain(..pos + 2).collect();
        events.push(String::from_utf8_lossy(&event_bytes[..pos]).into_owned());
    }
    events
}

fn find_double_newline(buf: &[u8]) -> Option<usize> {
    buf.windows(2).position(|w| w == b"\n\n")
}

/// Parses one already-split SSE event block. OpenRouter sends keep-alive
/// lines as `: comment` (SSE spec: `:`-prefixed lines are comments) — skipped,
/// same as `spike_llm_stream.rs`.
fn parse_sse_event(event: &str) -> SseOutcome {
    for line in event.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data == "[DONE]" {
            return SseOutcome::Done;
        }
        return parse_data_json(data);
    }
    SseOutcome::None
}

fn parse_data_json(data: &str) -> SseOutcome {
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return SseOutcome::None;
    };

    let error = value.get("error").filter(|e| !e.is_null()).map(|e| {
        e["message"]
            .as_str()
            .map(|m| format!("OpenRouter stream error: {m}"))
            .unwrap_or_else(|| format!("OpenRouter stream error: {e}"))
    });

    let choice = &value["choices"][0];
    let parsed = SseData {
        delta: choice["delta"]["content"]
            .as_str()
            .filter(|d| !d.is_empty())
            .map(str::to_string),
        finish_reason: choice["finish_reason"].as_str().map(str::to_string),
        usage: value.get("usage").filter(|u| !u.is_null()).map(|u| LlmUsage {
            input_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            output_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
            cost: u["cost"].as_f64(),
        }),
        model: value["model"].as_str().map(str::to_string),
        error,
    };

    if parsed == SseData::default() {
        SseOutcome::None
    } else {
        SseOutcome::Data(parsed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drain_sse_events_splits_on_blank_line_and_keeps_partial_tail() {
        let mut buf = b"data: a\n\ndata: b\n\ndata: partial".to_vec();
        let events = drain_sse_events(&mut buf);
        assert_eq!(events, vec!["data: a".to_string(), "data: b".to_string()]);
        assert_eq!(buf, b"data: partial");
    }

    #[test]
    fn drain_sse_events_returns_nothing_until_a_full_event_arrives() {
        let mut buf = b"data: incomplete".to_vec();
        assert!(drain_sse_events(&mut buf).is_empty());
        assert_eq!(buf, b"data: incomplete");
    }

    #[test]
    fn drain_sse_events_decodes_multibyte_utf8_codepoints_split_across_network_chunks() {
        // Regression test: OpenRouter can legitimately deliver a multi-byte
        // UTF-8 codepoint (e.g. Cyrillic) split across two separate
        // `bytes_stream()` items. The OLD implementation lossy-decoded each
        // incoming chunk on its own before appending to a `String` buffer,
        // which would turn the split codepoint into replacement-character
        // mojibake on both sides of the cut.
        let event = "data: {\"choices\":[{\"delta\":{\"content\":\"привет\"}}]}\n\n";
        let bytes = event.as_bytes();
        let privet_offset = event.find("привет").unwrap();
        // Split one byte into "п" (a 2-byte UTF-8 sequence), so the codepoint
        // is genuinely bisected rather than split at a convenient boundary.
        let split_at = privet_offset + 1;

        let mut buf: Vec<u8> = bytes[..split_at].to_vec();
        assert!(
            drain_sse_events(&mut buf).is_empty(),
            "no \\n\\n has arrived yet — nothing should be emitted"
        );

        buf.extend_from_slice(&bytes[split_at..]);
        let events = drain_sse_events(&mut buf);

        assert_eq!(events.len(), 1);
        assert!(
            events[0].contains("привет"),
            "multi-byte codepoint corrupted across a chunk boundary: {:?}",
            events[0]
        );
    }

    #[test]
    fn is_transient_status_flags_5xx_and_transient_4xx_as_retryable() {
        for status in [500, 502, 503, 504, 529, 408, 409, 425, 429] {
            assert!(is_transient_status(status), "{status} should be retryable");
        }
    }

    #[test]
    fn is_transient_status_treats_auth_and_bad_request_as_terminal() {
        for status in [400, 401, 403, 404, 422] {
            assert!(!is_transient_status(status), "{status} should not be retryable");
        }
    }

    #[test]
    fn parse_sse_event_skips_keep_alive_comments() {
        assert_eq!(parse_sse_event(": OPENROUTER PROCESSING"), SseOutcome::None);
    }

    #[test]
    fn parse_sse_event_skips_blank_events() {
        assert_eq!(parse_sse_event(""), SseOutcome::None);
    }

    #[test]
    fn parse_sse_event_recognizes_done_sentinel() {
        assert_eq!(parse_sse_event("data: [DONE]"), SseOutcome::Done);
    }

    fn data(delta: Option<&str>, finish: Option<&str>) -> SseData {
        SseData {
            delta: delta.map(str::to_string),
            finish_reason: finish.map(str::to_string),
            ..SseData::default()
        }
    }

    fn usage(input: u32, output: u32, cost: Option<f64>) -> LlmUsage {
        LlmUsage {
            input_tokens: input,
            output_tokens: output,
            cost,
        }
    }

    #[test]
    fn parse_sse_event_extracts_text_delta() {
        let event = r#"data: {"choices":[{"delta":{"content":"hi"}}]}"#;
        assert_eq!(parse_sse_event(event), SseOutcome::Data(data(Some("hi"), None)));
    }

    #[test]
    fn parse_sse_event_ignores_empty_delta_content() {
        let event = r#"data: {"choices":[{"delta":{"content":""}}]}"#;
        assert_eq!(parse_sse_event(event), SseOutcome::None);
    }

    #[test]
    fn parse_sse_event_keeps_content_that_arrives_with_the_finish_reason() {
        // Regression: the old parser checked finish_reason first and dropped
        // the last delta when both came in one chunk.
        let event = r#"data: {"choices":[{"delta":{"content":"end."},"finish_reason":"stop"}]}"#;
        assert_eq!(parse_sse_event(event), SseOutcome::Data(data(Some("end."), Some("stop"))));
    }

    #[test]
    fn parse_sse_event_extracts_usage_cost_and_model() {
        let event = r#"data: {"model":"anthropic/claude-haiku-4.5","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":34,"cost":0.0021}}"#;
        assert_eq!(
            parse_sse_event(event),
            SseOutcome::Data(SseData {
                usage: Some(usage(12, 34, Some(0.0021))),
                model: Some("anthropic/claude-haiku-4.5".to_string()),
                ..SseData::default()
            })
        );
    }

    #[test]
    fn parse_sse_event_treats_null_usage_as_absent() {
        let event = r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":null}"#;
        assert_eq!(parse_sse_event(event), SseOutcome::Data(data(None, Some("stop"))));
    }

    #[test]
    fn parse_sse_event_surfaces_a_mid_stream_provider_error() {
        let event = r#"data: {"error":{"message":"Provider overloaded","code":502}}"#;
        let SseOutcome::Data(parsed) = parse_sse_event(event) else {
            panic!("expected data");
        };
        assert_eq!(parsed.error.as_deref(), Some("OpenRouter stream error: Provider overloaded"));
    }

    #[test]
    fn stream_state_waits_for_the_usage_chunk_after_the_finish_reason() {
        // OpenRouter order: content… → finish_reason → usage (empty choices) → [DONE].
        let mut state = StreamState::default();
        let s1 = state.step(SseOutcome::Data(SseData {
            model: Some("m/served".to_string()),
            ..data(Some("hi"), None)
        }));
        assert_eq!(s1.chunks, vec![LlmChunk::TextDelta { delta: "hi".to_string() }]);
        assert!(!s1.terminal);

        let s2 = state.step(SseOutcome::Data(data(None, Some("length"))));
        assert!(s2.chunks.is_empty(), "finish must wait for usage");
        assert!(!s2.terminal);

        let s3 = state.step(SseOutcome::Data(SseData {
            usage: Some(usage(1, 2, Some(0.5))),
            ..SseData::default()
        }));
        assert!(s3.terminal);
        assert_eq!(
            s3.chunks,
            vec![LlmChunk::Finish {
                reason: "length".to_string(),
                usage: Some(usage(1, 2, Some(0.5))),
                model: Some("m/served".to_string()),
            }]
        );
    }

    #[test]
    fn stream_state_treats_an_empty_stream_as_a_retryable_failure() {
        // Regression (review): a bare `[DONE]` with no content and no reason
        // must not count as success — ResilientLlm must be able to fail over.
        let mut state = StreamState::default();
        state.step(SseOutcome::Data(SseData {
            model: Some("m".to_string()),
            ..SseData::default()
        }));
        let done = state.step(SseOutcome::Done);
        assert!(done.terminal);
        assert!(matches!(done.chunks[..], [LlmChunk::Error { retryable: true, .. }]));
    }

    #[test]
    fn stream_state_finishes_on_done_after_content_without_a_reason() {
        let mut state = StreamState::default();
        state.step(SseOutcome::Data(data(Some("x"), None)));
        let done = state.step(SseOutcome::Done);
        assert_eq!(
            done.chunks,
            vec![LlmChunk::Finish { reason: "stop".to_string(), usage: None, model: None }]
        );
    }

    #[test]
    fn stream_state_finishes_on_done_even_without_usage() {
        let mut state = StreamState::default();
        state.step(SseOutcome::Data(data(Some("x"), Some("stop"))));
        let done = state.step(SseOutcome::Done);
        assert!(done.terminal);
        assert_eq!(
            done.chunks,
            vec![LlmChunk::Finish { reason: "stop".to_string(), usage: None, model: None }]
        );
    }

    #[test]
    fn stream_state_end_of_body_finishes_after_a_reason_and_errors_without_one() {
        let mut finished = StreamState::default();
        finished.step(SseOutcome::Data(data(None, Some("stop"))));
        assert!(matches!(finished.end_of_body(), LlmChunk::Finish { .. }));

        let mut cut = StreamState::default();
        cut.step(SseOutcome::Data(data(Some("partial"), None)));
        assert_eq!(
            cut.end_of_body(),
            LlmChunk::Error {
                message: "OpenRouter stream ended without a finish signal".to_string(),
                retryable: true,
            }
        );
    }

    #[test]
    fn stream_state_turns_a_mid_stream_error_into_a_retryable_terminal_error() {
        let mut state = StreamState::default();
        let step = state.step(SseOutcome::Data(SseData {
            error: Some("boom".to_string()),
            ..SseData::default()
        }));
        assert!(step.terminal);
        assert_eq!(
            step.chunks,
            vec![LlmChunk::Error { message: "boom".to_string(), retryable: true }]
        );
    }

    #[test]
    fn parse_sse_event_ignores_malformed_json() {
        assert_eq!(parse_sse_event("data: not-json"), SseOutcome::None);
    }

    #[test]
    fn build_request_body_maps_roles_and_content_parts() {
        let request = LlmStreamRequest {
            model: "openai/gpt-4o-mini".to_string(),
            messages: vec![LlmMessage {
                role: LlmRole::User,
                parts: vec![
                    LlmContentPart::Text {
                        text: "describe this".to_string(),
                    },
                    LlmContentPart::Image {
                        image_base64: "QUJD".to_string(),
                    },
                ],
            }],
            temperature: None,
            reasoning_effort: None,
            max_image_edge: None,
        };

        let body = build_request_body(&request);
        assert_eq!(body["model"], "openai/gpt-4o-mini");
        assert_eq!(body["stream"], true);
        assert_eq!(body["usage"]["include"], true);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"][0]["type"], "text");
        assert_eq!(body["messages"][0]["content"][0]["text"], "describe this");
        assert_eq!(body["messages"][0]["content"][1]["type"], "image_url");
        assert_eq!(
            body["messages"][0]["content"][1]["image_url"]["url"],
            "data:image/png;base64,QUJD"
        );
    }

    #[test]
    fn build_request_body_sends_system_content_as_a_plain_string() {
        // Regression guard: the system role must serialize `content` as a plain
        // string, NOT an array of content parts. Some providers behind
        // OpenRouter (e.g. the Gemini `systemInstruction` mapping) reject or
        // silently drop the array form for the system role, which would strip
        // the agent's role prompt on a fallback model. The dev adapter
        // (`openrouter-llm.adapter.ts`) already stringifies system content;
        // this keeps the native path consistent with it.
        let request = LlmStreamRequest {
            model: "openai/gpt-4o-mini".to_string(),
            messages: vec![
                LlmMessage {
                    role: LlmRole::System,
                    parts: vec![LlmContentPart::Text {
                        text: "You are a senior code reviewer.".to_string(),
                    }],
                },
                LlmMessage {
                    role: LlmRole::User,
                    parts: vec![LlmContentPart::Text {
                        text: "review this".to_string(),
                    }],
                },
            ],
            temperature: None,
            reasoning_effort: None,
            max_image_edge: None,
        };

        let body = build_request_body(&request);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(
            body["messages"][0]["content"],
            "You are a senior code reviewer."
        );
        // The user role keeps the array-of-parts shape.
        assert!(body["messages"][1]["content"].is_array());
        assert_eq!(body["messages"][1]["content"][0]["text"], "review this");
    }

    fn text_request() -> LlmStreamRequest {
        LlmStreamRequest {
            model: "m".to_string(),
            messages: vec![LlmMessage {
                role: LlmRole::User,
                parts: vec![LlmContentPart::Text { text: "q".to_string() }],
            }],
            temperature: None,
            reasoning_effort: None,
            max_image_edge: None,
        }
    }

    #[test]
    fn build_request_body_omits_unset_parameters_and_never_sends_max_tokens() {
        let body = build_request_body(&text_request());
        assert!(body.get("temperature").is_none());
        assert!(body.get("reasoning").is_none());
        // Completeness over caps (user decision 2026-07-22).
        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn build_request_body_sends_temperature_and_excluded_reasoning_when_set() {
        let mut request = text_request();
        request.temperature = Some(0.3);
        request.reasoning_effort = Some("medium".to_string());
        let body = build_request_body(&request);
        assert_eq!(body["temperature"], 0.3);
        assert_eq!(body["reasoning"]["effort"], "medium");
        // The thinking is not streamed back to the HUD.
        assert_eq!(body["reasoning"]["exclude"], true);
        assert!(body.get("max_tokens").is_none());
    }
}
