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
                send_error(channel, format!("OpenRouter request failed: {e}"));
                return;
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            send_error(channel, format!("OpenRouter HTTP {status}: {text}"));
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

        while let Some(item) = stream.next().await {
            let bytes = match item {
                Ok(b) => b,
                Err(e) => {
                    send_error(channel, format!("OpenRouter stream read failed: {e}"));
                    return;
                }
            };
            buf.extend_from_slice(&bytes);

            for event in drain_sse_events(&mut buf) {
                match parse_sse_event(&event) {
                    SseOutcome::None => continue,
                    SseOutcome::Done => return,
                    SseOutcome::Chunk(chunk) => {
                        let is_terminal = matches!(chunk, LlmChunk::Finish { .. });
                        let _ = channel.send(chunk);
                        if is_terminal {
                            return;
                        }
                    }
                }
            }
        }

        // The HTTP body ended without an explicit terminator (`[DONE]` or a
        // `finish_reason` chunk) — surface it instead of leaving the webview
        // awaiting a stream that silently stopped.
        send_error(
            channel,
            "OpenRouter stream ended without a finish signal".to_string(),
        );
    }
}

impl Default for OpenRouterClient {
    fn default() -> Self {
        Self::new()
    }
}

fn send_error(channel: &Channel<LlmChunk>, message: String) {
    let _ = channel.send(LlmChunk::Error { message });
}

/// Builds the OpenAI-compatible chat-completions request body. `usage.include`
/// is requested explicitly — OpenRouter omits token/cost accounting otherwise
/// (see decisions.md "Спайк llm_stream": usage came back `null` without it).
fn build_request_body(request: &LlmStreamRequest) -> Value {
    json!({
        "model": request.model,
        "stream": true,
        "usage": { "include": true },
        "messages": request.messages.iter().map(to_openai_message).collect::<Vec<_>>(),
    })
}

fn to_openai_message(message: &LlmMessage) -> Value {
    json!({
        "role": role_str(&message.role),
        "content": message.parts.iter().map(to_openai_content_part).collect::<Vec<_>>(),
    })
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

/// Outcome of parsing a single SSE event block.
#[derive(Debug, PartialEq)]
enum SseOutcome {
    /// Keep-alive comment or an event with no actionable `data:` line.
    None,
    /// `data: [DONE]` — the stream is over.
    Done,
    Chunk(LlmChunk),
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

    if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
        let usage = value.get("usage").filter(|u| !u.is_null()).map(|u| LlmUsage {
            input_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            output_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
        });
        return SseOutcome::Chunk(LlmChunk::Finish {
            reason: reason.to_string(),
            usage,
        });
    }

    if let Some(delta) = value["choices"][0]["delta"]["content"].as_str() {
        if !delta.is_empty() {
            return SseOutcome::Chunk(LlmChunk::TextDelta {
                delta: delta.to_string(),
            });
        }
    }

    SseOutcome::None
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

    #[test]
    fn parse_sse_event_extracts_text_delta() {
        let event = r#"data: {"choices":[{"delta":{"content":"hi"}}]}"#;
        assert_eq!(
            parse_sse_event(event),
            SseOutcome::Chunk(LlmChunk::TextDelta {
                delta: "hi".to_string()
            })
        );
    }

    #[test]
    fn parse_sse_event_ignores_empty_delta_content() {
        let event = r#"data: {"choices":[{"delta":{"content":""}}]}"#;
        assert_eq!(parse_sse_event(event), SseOutcome::None);
    }

    #[test]
    fn parse_sse_event_extracts_finish_with_usage() {
        let event = r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":34}}"#;
        assert_eq!(
            parse_sse_event(event),
            SseOutcome::Chunk(LlmChunk::Finish {
                reason: "stop".to_string(),
                usage: Some(LlmUsage {
                    input_tokens: 12,
                    output_tokens: 34,
                }),
            })
        );
    }

    #[test]
    fn parse_sse_event_extracts_finish_without_usage_when_null() {
        let event = r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":null}"#;
        assert_eq!(
            parse_sse_event(event),
            SseOutcome::Chunk(LlmChunk::Finish {
                reason: "stop".to_string(),
                usage: None,
            })
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
}
