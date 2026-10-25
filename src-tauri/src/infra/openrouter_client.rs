//! `OpenRouterClient` — production impl of the secure-native LLM streaming
//! HTTP call (phase 2). Ported from `examples/spike_llm_stream.rs` (phase
//! 0.5), which already validated the full mechanism (reqwest SSE ->
//! `tauri::ipc::Channel`) against a live OpenRouter call — see decisions.md
//! "Спайк llm_stream". Differences from the spike: reads the key from
//! `SecretStore` instead of env (handled by the caller, `commands/llm.rs`),
//! and every failure path (HTTP error, network error, malformed stream) is
//! delivered as a terminal `LlmChunk::Error` instead of a process exit.

use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::dto::{
    DataCollection, LlmChunk, LlmContentPart, LlmMessage, LlmRole, LlmStreamRequest, LlmUsage,
    ProviderPreference,
};

const OPENROUTER_CHAT_COMPLETIONS_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// TCP/TLS connect timeout (`AI_HELPER_LLM_CONNECT_TIMEOUT_MS`).
const CONNECT_TIMEOUT_ENV: &str = "AI_HELPER_LLM_CONNECT_TIMEOUT_MS";
const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 10_000;
/// Time allowed from sending the request until the FIRST byte of the response
/// body (`AI_HELPER_LLM_FIRST_BYTE_TIMEOUT_MS`).
const FIRST_BYTE_TIMEOUT_ENV: &str = "AI_HELPER_LLM_FIRST_BYTE_TIMEOUT_MS";
const DEFAULT_FIRST_BYTE_TIMEOUT_MS: u64 = 30_000;
/// Longest silence tolerated between two body chunks once streaming
/// (`AI_HELPER_LLM_IDLE_TIMEOUT_MS`).
const IDLE_TIMEOUT_ENV: &str = "AI_HELPER_LLM_IDLE_TIMEOUT_MS";
const DEFAULT_IDLE_TIMEOUT_MS: u64 = 60_000;

/// Watchdog for the streaming request (2026-10 review §3.1). Without it a
/// provider that accepts the connection and then hangs kept `llm_stream` open
/// forever: no error chunk, hence no failover — exactly the "provider is
/// down" case the failover exists for; only a manual Stop helped.
///
/// The watchdog counts BYTES, not tokens: OpenRouter sends `: OPENROUTER
/// PROCESSING` keep-alive comments while the model is still thinking, so a
/// long reasoning phase keeps resetting the idle timer and is never mistaken
/// for a hang, while a dead connection (no bytes at all) is. A timeout before
/// the first text delta is reported as a retryable error, so `ResilientLlm`
/// moves on to the next model; after content has streamed the same error just
/// ends the answer ("Interrupted" in the HUD).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamTimeouts {
    pub connect: Duration,
    pub first_byte: Duration,
    pub idle: Duration,
}

impl Default for StreamTimeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_millis(DEFAULT_CONNECT_TIMEOUT_MS),
            first_byte: Duration::from_millis(DEFAULT_FIRST_BYTE_TIMEOUT_MS),
            idle: Duration::from_millis(DEFAULT_IDLE_TIMEOUT_MS),
        }
    }
}

impl StreamTimeouts {
    /// The timeouts from the process environment (see the `*_ENV` constants).
    pub fn from_env() -> Self {
        resolve_timeouts(
            std::env::var(CONNECT_TIMEOUT_ENV).ok().as_deref(),
            std::env::var(FIRST_BYTE_TIMEOUT_ENV).ok().as_deref(),
            std::env::var(IDLE_TIMEOUT_ENV).ok().as_deref(),
        )
    }
}

/// Parses the env overrides: a positive integer of milliseconds, anything
/// else (unset, blank, zero, garbage) keeps the default. Pure — unit-tested.
fn resolve_timeouts(connect: Option<&str>, first_byte: Option<&str>, idle: Option<&str>) -> StreamTimeouts {
    let defaults = StreamTimeouts::default();
    let pick = |raw: Option<&str>, default: Duration| {
        raw.and_then(|v| v.trim().parse::<u64>().ok())
            .filter(|&ms| ms > 0)
            .map_or(default, Duration::from_millis)
    };
    StreamTimeouts {
        connect: pick(connect, defaults.connect),
        first_byte: pick(first_byte, defaults.first_byte),
        idle: pick(idle, defaults.idle),
    }
}

/// How long to wait for the next body chunk: the remainder of the first-byte
/// budget (measured from when the request was sent) until anything arrived,
/// then the idle gap. Pure — unit-tested.
fn next_chunk_wait(timeouts: &StreamTimeouts, started: Instant, now: Instant, received_any: bool) -> Duration {
    if received_any {
        timeouts.idle
    } else {
        timeouts.first_byte.saturating_sub(now.saturating_duration_since(started))
    }
}

/// `provider.data_collection` override: `deny` (default) or `allow`.
const DATA_COLLECTION_ENV: &str = "AI_HELPER_DATA_COLLECTION";
/// `provider.zdr` override: `true`/`1`/`on` routes only to zero-data-retention endpoints.
const ZDR_ENV: &str = "AI_HELPER_ZDR";

/// OpenRouter provider preferences sent with every chat request (2026-10
/// review §2.3). OpenRouter is a router: a request to a model slug lands on
/// one of several upstream endpoints with different logging/training
/// policies. What this app sends — screenshots of screens that are often not
/// the user's own, and the interlocutor's voice as a transcript — must not end
/// up with a provider that retains or trains on it, so by default routing is
/// restricted to providers whose published policy is "no data collection".
/// `zdr` narrows further to zero-data-retention endpoints (fewer providers;
/// off by default). Not sent on the STT upload: that endpoint's support for
/// provider preferences is unverified and an unknown multipart field could
/// reject the whole request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderPolicy {
    /// `true` → `"data_collection": "deny"`; `false` → OpenRouter's default routing.
    pub deny_data_collection: bool,
    /// `true` → `"zdr": true`.
    pub zdr: bool,
}

impl Default for ProviderPolicy {
    fn default() -> Self {
        Self {
            deny_data_collection: true,
            zdr: false,
        }
    }
}

impl ProviderPolicy {
    /// The policy from the process environment alone (see the `*_ENV`
    /// constants): the env overrides applied to the default.
    pub fn from_env() -> Self {
        PolicyOverrides::from_env().apply(ProviderPolicy::default())
    }
}

impl From<&ProviderPreference> for ProviderPolicy {
    fn from(preference: &ProviderPreference) -> Self {
        Self {
            deny_data_collection: preference.data_collection == DataCollection::Deny,
            zdr: preference.zdr,
        }
    }
}

/// Per-field env overrides (`AI_HELPER_DATA_COLLECTION`, `AI_HELPER_ZDR`).
/// Since F2 the request carries the policy chosen in the settings screen;
/// a variable that is set still wins for its field — the env is the
/// operator's/debugging override, the file is the user's choice.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PolicyOverrides {
    pub deny_data_collection: Option<bool>,
    pub zdr: Option<bool>,
}

impl PolicyOverrides {
    pub fn from_env() -> Self {
        resolve_policy_overrides(
            std::env::var(DATA_COLLECTION_ENV).ok().as_deref(),
            std::env::var(ZDR_ENV).ok().as_deref(),
        )
    }

    /// `base` (the request's preference, or the default) with every set
    /// override applied on top.
    pub fn apply(&self, base: ProviderPolicy) -> ProviderPolicy {
        ProviderPolicy {
            deny_data_collection: self.deny_data_collection.unwrap_or(base.deny_data_collection),
            zdr: self.zdr.unwrap_or(base.zdr),
        }
    }
}

/// Parses the env overrides. `data_collection`: `allow` turns the restriction
/// off, any other non-blank value (`deny`, a typo) pins the safe default,
/// unset/blank leaves the field to the request. `zdr`: `true`/`1`/`on`/`yes`
/// enables it, any other non-blank value disables it. Pure — unit-tested.
fn resolve_policy_overrides(data_collection: Option<&str>, zdr: Option<&str>) -> PolicyOverrides {
    let deny_data_collection = data_collection
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| !v.eq_ignore_ascii_case("allow"));
    let zdr = zdr
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .map(|v| matches!(v.as_str(), "true" | "1" | "on" | "yes"));
    PolicyOverrides {
        deny_data_collection,
        zdr,
    }
}

/// The env-only resolution (kept for its tests): overrides over the default.
#[cfg(test)]
fn resolve_provider_policy(data_collection: Option<&str>, zdr: Option<&str>) -> ProviderPolicy {
    resolve_policy_overrides(data_collection, zdr).apply(ProviderPolicy::default())
}

/// The `provider` object for the request body, or `None` when the policy is
/// OpenRouter's default (nothing to send).
fn provider_preferences(policy: &ProviderPolicy) -> Option<Value> {
    let mut provider = serde_json::Map::new();
    if policy.deny_data_collection {
        provider.insert("data_collection".to_string(), json!("deny"));
    }
    if policy.zdr {
        provider.insert("zdr".to_string(), json!(true));
    }
    (!provider.is_empty()).then_some(Value::Object(provider))
}

pub struct OpenRouterClient {
    http: reqwest::Client,
    /// Policy for requests that carry no preference of their own.
    policy: ProviderPolicy,
    /// Env overrides applied on top of whichever policy a request resolves to.
    overrides: PolicyOverrides,
    timeouts: StreamTimeouts,
    chat_url: String,
}

impl OpenRouterClient {
    pub fn new() -> Self {
        let mut client = Self::with_config(
            OPENROUTER_CHAT_COMPLETIONS_URL,
            ProviderPolicy::default(),
            StreamTimeouts::from_env(),
        );
        client.overrides = PolicyOverrides::from_env();
        client
    }

    /// The policy a request is sent with: its own preference (settings, F2)
    /// or the client's default, with the env overrides on top.
    pub fn effective_policy(&self, request: &LlmStreamRequest) -> ProviderPolicy {
        let base = request
            .provider
            .as_ref()
            .map(ProviderPolicy::from)
            .unwrap_or_else(|| self.policy.clone());
        self.overrides.apply(base)
    }

    /// Explicit configuration — production uses `new()`; tests point `chat_url`
    /// at a local server and shrink the timeouts.
    pub fn with_config(chat_url: &str, policy: ProviderPolicy, timeouts: StreamTimeouts) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(timeouts.connect)
            .build()
            // Building only fails on a broken TLS backend; the plain client
            // would fail the same way, just without the connect timeout.
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            http,
            policy,
            overrides: PolicyOverrides::default(),
            timeouts,
            chat_url: chat_url.to_string(),
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
        let policy = self.effective_policy(request);
        let body = build_request_body(request, &policy);
        let started = Instant::now();
        let first_byte_secs = self.timeouts.first_byte.as_secs_f64();
        log::info!(
            "llm_stream: model={} messages={} images={} reasoning={} max_edge={:?} data_collection={} zdr={}",
            request.model,
            request.messages.len(),
            request
                .messages
                .iter()
                .flat_map(|m| m.parts.iter())
                .filter(|p| matches!(p, LlmContentPart::Image { .. }))
                .count(),
            request.reasoning_effort.as_deref().unwrap_or("off"),
            request.max_image_edge,
            if policy.deny_data_collection { "deny" } else { "allow" },
            policy.zdr,
        );

        // The response headers must arrive within the first-byte budget too.
        let send = self
            .http
            .post(&self.chat_url)
            .bearer_auth(api_key)
            .json(&body)
            .send();
        let response = match tokio::time::timeout(self.timeouts.first_byte, send).await {
            Ok(Ok(resp)) => resp,
            Ok(Err(e)) => {
                // Network/transport failure reaching OpenRouter — transient, so
                // another model (or a retry) may well succeed: retryable.
                send_error(channel, format!("OpenRouter request failed: {e}"), true);
                return;
            }
            Err(_) => {
                send_error(
                    channel,
                    format!("OpenRouter did not respond within {first_byte_secs:.0}s"),
                    true,
                );
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
        let mut received_any = false;

        loop {
            // Watchdog: the rest of the first-byte budget until the body starts,
            // then the idle gap between chunks (keep-alive comments count).
            let wait = next_chunk_wait(&self.timeouts, started, Instant::now(), received_any);
            let item = match tokio::time::timeout(wait, stream.next()).await {
                Ok(Some(item)) => item,
                Ok(None) => break,
                Err(_) => {
                    let message = if received_any {
                        format!(
                            "OpenRouter stream stalled: no data for {:.0}s",
                            self.timeouts.idle.as_secs_f64()
                        )
                    } else {
                        format!("OpenRouter sent no data within {first_byte_secs:.0}s")
                    };
                    // A stall is provider-side and transient: retryable, so a
                    // pre-content stall fails over to the next model.
                    send_error(channel, message, true);
                    return;
                }
            };
            let bytes = match item {
                Ok(b) => b,
                Err(e) => {
                    // Transient read failure on the byte stream — retryable.
                    send_error(channel, format!("OpenRouter stream read failed: {e}"), true);
                    return;
                }
            };
            received_any = true;
            buf.extend_from_slice(&bytes);

            for event in drain_sse_events(&mut buf) {
                let step = state.step(parse_sse_event(&event));
                for chunk in step.chunks {
                    if step.terminal {
                        log_terminal(&chunk, started);
                    }
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
        let last = state.end_of_body();
        log_terminal(&last, started);
        let _ = channel.send(last);
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
    log::warn!("llm_stream: error (retryable={retryable}): {message}");
    let _ = channel.send(LlmChunk::Error { message, retryable });
}

/// One log line per completed stream: outcome, model, tokens, cost, duration —
/// never the content (logging policy, lib.rs).
fn log_terminal(chunk: &LlmChunk, started: Instant) {
    let ms = started.elapsed().as_millis();
    match chunk {
        LlmChunk::Finish { reason, usage, model } => log::info!(
            "llm_stream: finish reason={reason} model={} tokens={} cost={} in {ms} ms",
            model.as_deref().unwrap_or("?"),
            usage
                .as_ref()
                .map_or("?".to_string(), |u| format!("{}->{}", u.input_tokens, u.output_tokens)),
            usage
                .as_ref()
                .and_then(|u| u.cost)
                .map_or("?".to_string(), |c| format!("{c:.4}")),
        ),
        LlmChunk::Error { message, retryable } => {
            log::warn!("llm_stream: terminal error (retryable={retryable}) after {ms} ms: {message}")
        }
        LlmChunk::TextDelta { .. } => {}
    }
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
///
/// `provider` carries the data policy (see `ProviderPolicy`) — omitted only
/// when the policy is OpenRouter's default.
fn build_request_body(request: &LlmStreamRequest, policy: &ProviderPolicy) -> Value {
    let mut body = json!({
        "model": request.model,
        "stream": true,
        "usage": { "include": true },
        "messages": request
            .messages
            .iter()
            .map(|message| to_openai_message(message, &request.model))
            .collect::<Vec<_>>(),
    });
    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(effort) = &request.reasoning_effort {
        body["reasoning"] = json!({ "effort": effort, "exclude": true });
    }
    if let Some(provider) = provider_preferences(policy) {
        body["provider"] = provider;
    }
    body
}

fn to_openai_message(message: &LlmMessage, model: &str) -> Value {
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
    let mut content = message.parts.iter().map(to_openai_content_part).collect::<Vec<_>>();
    if message.cache && needs_explicit_cache_marker(model) {
        // The breakpoint goes on the message's last TEXT part: OpenRouter
        // documents `cache_control` on text parts, and the cached prefix still
        // covers every part before it (images included).
        if let Some(part) = content.iter_mut().rev().find(|part| part["type"] == "text") {
            part["cache_control"] = json!({ "type": "ephemeral" });
        }
    }
    json!({
        "role": role_str(&message.role),
        "content": content,
    })
}

/// Whether the model's provider caches prompts only behind an explicit
/// `cache_control` breakpoint. Anthropic does (via OpenRouter); OpenAI and
/// Gemini cache long prefixes automatically, and other providers would at best
/// ignore the marker — so it is sent to Anthropic models only, never risking a
/// 400 on a fallback model.
fn needs_explicit_cache_marker(model: &str) -> bool {
    model.starts_with("anthropic/")
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
            cached_tokens: u["prompt_tokens_details"]["cached_tokens"]
                .as_u64()
                .filter(|&n| n > 0)
                .map(|n| n as u32),
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
            cached_tokens: None,
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
    fn parse_sse_event_extracts_cached_prompt_tokens() {
        let event = r#"data: {"choices":[],"usage":{"prompt_tokens":5000,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":4096}}}"#;
        let SseOutcome::Data(data) = parse_sse_event(event) else {
            panic!("expected data");
        };
        assert_eq!(data.usage.unwrap().cached_tokens, Some(4096));

        // Zero (a cache miss) reads as absent: nothing to show in the HUD.
        let miss = r#"data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":0}}}"#;
        let SseOutcome::Data(data) = parse_sse_event(miss) else {
            panic!("expected data");
        };
        assert_eq!(data.usage.unwrap().cached_tokens, None);
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
                cache: false,
            }],
            temperature: None,
            reasoning_effort: None,
            max_image_edge: None,
            request_id: None,
            provider: None,
        };

        let body = build_request_body(&request, &ProviderPolicy::default());
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
                    cache: false,
                },
                LlmMessage {
                    role: LlmRole::User,
                    parts: vec![LlmContentPart::Text {
                        text: "review this".to_string(),
                    }],
                    cache: false,
                },
            ],
            temperature: None,
            reasoning_effort: None,
            max_image_edge: None,
            request_id: None,
            provider: None,
        };

        let body = build_request_body(&request, &ProviderPolicy::default());
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
                cache: false,
            }],
            temperature: None,
            reasoning_effort: None,
            max_image_edge: None,
            request_id: None,
            provider: None,
        }
    }

    #[test]
    fn build_request_body_omits_unset_parameters_and_never_sends_max_tokens() {
        let body = build_request_body(&text_request(), &ProviderPolicy::default());
        assert!(body.get("temperature").is_none());
        assert!(body.get("reasoning").is_none());
        // Completeness over caps (user decision 2026-07-22).
        assert!(body.get("max_tokens").is_none());
    }

    #[test]
    fn build_request_body_denies_provider_data_collection_by_default() {
        // 2026-10 review §2.3: other people's screens and voice must not be
        // routed to a provider that stores or trains on prompts.
        let body = build_request_body(&text_request(), &ProviderPolicy::default());
        assert_eq!(body["provider"]["data_collection"], "deny");
        assert!(body["provider"].get("zdr").is_none());
    }

    #[test]
    fn build_request_body_omits_provider_preferences_when_allowed_and_sends_zdr_when_asked() {
        let allow = ProviderPolicy { deny_data_collection: false, zdr: false };
        assert!(build_request_body(&text_request(), &allow).get("provider").is_none());

        let strict = ProviderPolicy { deny_data_collection: true, zdr: true };
        let body = build_request_body(&text_request(), &strict);
        assert_eq!(body["provider"]["data_collection"], "deny");
        assert_eq!(body["provider"]["zdr"], true);
    }

    #[test]
    fn effective_policy_env_overrides_win_over_the_request_preference() {
        let client =
            OpenRouterClient::with_config("http://localhost:1/x", ProviderPolicy::default(), StreamTimeouts::default());
        // No preference on the request → the client's default policy.
        assert_eq!(client.effective_policy(&text_request()), ProviderPolicy::default());
        // The request's preference (settings screen, F2) is used as-is when
        // no env var is set.
        let mut request = text_request();
        request.provider = Some(ProviderPreference {
            data_collection: DataCollection::Allow,
            zdr: true,
        });
        assert_eq!(
            client.effective_policy(&request),
            ProviderPolicy { deny_data_collection: false, zdr: true }
        );
        // A set env var wins for its field only.
        let mut pinned =
            OpenRouterClient::with_config("http://localhost:1/x", ProviderPolicy::default(), StreamTimeouts::default());
        pinned.overrides = resolve_policy_overrides(Some("deny"), None);
        assert_eq!(
            pinned.effective_policy(&request),
            ProviderPolicy { deny_data_collection: true, zdr: true }
        );
        pinned.overrides = resolve_policy_overrides(None, Some("off"));
        assert_eq!(
            pinned.effective_policy(&request),
            ProviderPolicy { deny_data_collection: false, zdr: false }
        );
    }

    #[test]
    fn policy_overrides_parse_only_non_blank_values() {
        assert_eq!(resolve_policy_overrides(None, None), PolicyOverrides::default());
        assert_eq!(resolve_policy_overrides(Some(" "), Some("")), PolicyOverrides::default());
        assert_eq!(
            resolve_policy_overrides(Some("allow"), Some("1")),
            PolicyOverrides { deny_data_collection: Some(false), zdr: Some(true) }
        );
        assert_eq!(
            resolve_policy_overrides(Some("deny"), Some("no")),
            PolicyOverrides { deny_data_collection: Some(true), zdr: Some(false) }
        );
    }

    #[test]
    fn provider_policy_env_defaults_to_deny_and_only_an_explicit_allow_relaxes_it() {
        assert_eq!(resolve_provider_policy(None, None), ProviderPolicy::default());
        assert_eq!(resolve_provider_policy(Some(""), Some("")), ProviderPolicy::default());
        assert_eq!(resolve_provider_policy(Some("deny"), None), ProviderPolicy::default());
        assert_eq!(resolve_provider_policy(Some("alow"), None), ProviderPolicy::default());
        assert_eq!(
            resolve_provider_policy(Some(" Allow "), Some("true")),
            ProviderPolicy { deny_data_collection: false, zdr: true }
        );
        assert!(resolve_provider_policy(None, Some("1")).zdr);
        assert!(resolve_provider_policy(None, Some("ON")).zdr);
        assert!(!resolve_provider_policy(None, Some("false")).zdr);
    }

    #[test]
    fn build_request_body_sends_temperature_and_excluded_reasoning_when_set() {
        let mut request = text_request();
        request.temperature = Some(0.3);
        request.reasoning_effort = Some("medium".to_string());
        let body = build_request_body(&request, &ProviderPolicy::default());
        assert_eq!(body["temperature"], 0.3);
        assert_eq!(body["reasoning"]["effort"], "medium");
        // The thinking is not streamed back to the HUD.
        assert_eq!(body["reasoning"]["exclude"], true);
        assert!(body.get("max_tokens").is_none());
    }

    fn dialog_request(model: &str) -> LlmStreamRequest {
        let text = |t: &str| LlmContentPart::Text { text: t.to_string() };
        let mut request = text_request();
        request.model = model.to_string();
        request.messages = vec![
            LlmMessage { role: LlmRole::System, parts: vec![text("sys")], cache: false },
            LlmMessage { role: LlmRole::User, parts: vec![text("q1")], cache: false },
            LlmMessage { role: LlmRole::Assistant, parts: vec![text("a1")], cache: false },
            LlmMessage {
                role: LlmRole::User,
                parts: vec![
                    LlmContentPart::Image { image_base64: "QUJD".to_string() },
                    text("q2"),
                ],
                cache: true,
            },
        ];
        request
    }

    #[test]
    fn build_request_body_marks_the_cache_breakpoint_for_anthropic_models() {
        let body =
            build_request_body(&dialog_request("anthropic/claude-haiku-4.5"), &ProviderPolicy::default());
        let last = &body["messages"][3]["content"];
        // On the last text part; the image before it is still in the cached prefix.
        assert_eq!(last[1]["cache_control"]["type"], "ephemeral");
        assert!(last[0].get("cache_control").is_none());
        // Unmarked messages carry no breakpoint.
        assert!(body["messages"][1]["content"][0].get("cache_control").is_none());
        assert_eq!(body["messages"][0]["content"], "sys");
    }

    #[test]
    fn build_request_body_sends_no_cache_marker_to_other_providers() {
        for model in ["google/gemini-3.1-flash-lite", "openai/gpt-4o-mini"] {
            let body = build_request_body(&dialog_request(model), &ProviderPolicy::default());
            let serialized = body.to_string();
            assert!(!serialized.contains("cache_control"), "{model}: {serialized}");
        }
    }

    // --- Stream watchdog (2026-10 review §3.1) -----------------------------

    #[test]
    fn stream_timeouts_env_overrides_apply_only_when_positive_integers() {
        let d = StreamTimeouts::default();
        assert_eq!(resolve_timeouts(None, None, None), d);
        assert_eq!(resolve_timeouts(Some(""), Some("0"), Some("soon")), d);
        assert_eq!(
            resolve_timeouts(Some(" 5000 "), Some("15000"), Some("90000")),
            StreamTimeouts {
                connect: Duration::from_millis(5000),
                first_byte: Duration::from_millis(15000),
                idle: Duration::from_millis(90000),
            }
        );
    }

    #[test]
    fn next_chunk_wait_spends_the_first_byte_budget_then_switches_to_the_idle_gap() {
        let t = StreamTimeouts {
            connect: Duration::from_secs(1),
            first_byte: Duration::from_millis(300),
            idle: Duration::from_millis(1000),
        };
        let started = Instant::now();
        assert_eq!(next_chunk_wait(&t, started, started, false), Duration::from_millis(300));
        assert_eq!(
            next_chunk_wait(&t, started, started + Duration::from_millis(100), false),
            Duration::from_millis(200)
        );
        // Budget exhausted: zero wait, the very next poll times out.
        assert_eq!(next_chunk_wait(&t, started, started + Duration::from_secs(5), false), Duration::ZERO);
        // Once anything arrived, every chunk gets the full idle gap.
        assert_eq!(next_chunk_wait(&t, started, started + Duration::from_secs(5), true), Duration::from_millis(1000));
    }

    // Live-socket scenarios: a tiny local HTTP/1.1 server drives the client's
    // real `reqwest` path, so the timeouts are exercised exactly as in
    // production (minus TLS). Bodies are "until close" (no Content-Length).
    mod watchdog {
        use super::*;
        use std::future::Future;
        use std::sync::{Arc, Mutex};
        use tauri::ipc::InvokeResponseBody;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::{TcpListener, TcpStream};

        const HEADERS: &[u8] =
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
        const DELTA: &[u8] = b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n";
        const DONE: &[u8] = b"data: [DONE]\n\n";

        fn fast() -> StreamTimeouts {
            StreamTimeouts {
                connect: Duration::from_secs(2),
                first_byte: Duration::from_millis(250),
                idle: Duration::from_millis(150),
            }
        }

        /// Serves exactly one connection with `handler`; returns the chat URL.
        async fn serve_once<F, Fut>(handler: F) -> String
        where
            F: FnOnce(TcpStream) -> Fut + Send + 'static,
            Fut: Future<Output = ()> + Send,
        {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tokio::spawn(async move {
                if let Ok((stream, _)) = listener.accept().await {
                    handler(stream).await;
                }
            });
            format!("http://{addr}/api/v1/chat/completions")
        }

        /// Reads whatever the client sent first (headers + the small JSON body).
        async fn read_request(stream: &mut TcpStream) {
            let mut buf = vec![0u8; 8192];
            let _ = stream.read(&mut buf).await;
        }

        /// Runs the client against `url` and returns every chunk it sent.
        async fn collect(url: &str, timeouts: StreamTimeouts) -> Vec<LlmChunk> {
            let chunks = Arc::new(Mutex::new(Vec::new()));
            let sink = chunks.clone();
            let channel = Channel::new(move |body: InvokeResponseBody| {
                if let InvokeResponseBody::Json(json) = body {
                    sink.lock().unwrap().push(serde_json::from_str::<LlmChunk>(&json).unwrap());
                }
                Ok(())
            });
            let client = OpenRouterClient::with_config(url, ProviderPolicy::default(), timeouts);
            client.stream_chat("test-key", &text_request(), &channel).await;
            let out = chunks.lock().unwrap().clone();
            out
        }

        fn is_retryable_error(chunk: &LlmChunk, needle: &str) -> bool {
            matches!(chunk, LlmChunk::Error { message, retryable: true } if message.contains(needle))
        }

        #[tokio::test]
        async fn a_server_that_never_responds_fails_over_within_the_first_byte_budget() {
            let url = serve_once(|mut s| async move {
                read_request(&mut s).await;
                tokio::time::sleep(Duration::from_secs(5)).await;
            })
            .await;

            let started = Instant::now();
            let chunks = collect(&url, fast()).await;

            assert!(started.elapsed() < Duration::from_secs(2), "took {:?}", started.elapsed());
            assert_eq!(chunks.len(), 1, "{chunks:?}");
            assert!(is_retryable_error(&chunks[0], "did not respond"), "{chunks:?}");
        }

        #[tokio::test]
        async fn headers_without_any_body_time_out_as_a_retryable_error() {
            let url = serve_once(|mut s| async move {
                read_request(&mut s).await;
                s.write_all(HEADERS).await.unwrap();
                s.flush().await.unwrap();
                tokio::time::sleep(Duration::from_secs(5)).await;
            })
            .await;

            let chunks = collect(&url, fast()).await;

            assert_eq!(chunks.len(), 1, "{chunks:?}");
            assert!(is_retryable_error(&chunks[0], "sent no data"), "{chunks:?}");
        }

        #[tokio::test]
        async fn a_stall_after_content_ends_the_answer_with_a_retryable_error() {
            let url = serve_once(|mut s| async move {
                read_request(&mut s).await;
                s.write_all(HEADERS).await.unwrap();
                s.write_all(DELTA).await.unwrap();
                s.flush().await.unwrap();
                tokio::time::sleep(Duration::from_secs(5)).await;
            })
            .await;

            let chunks = collect(&url, fast()).await;

            assert_eq!(chunks.len(), 2, "{chunks:?}");
            assert_eq!(chunks[0], LlmChunk::TextDelta { delta: "hi".to_string() });
            assert!(is_retryable_error(&chunks[1], "stalled"), "{chunks:?}");
        }

        #[tokio::test]
        async fn keep_alive_comments_reset_the_idle_timer_while_the_model_thinks() {
            // 6 × 60 ms of keep-alives = 360 ms of "no tokens" against a 150 ms
            // idle gap: bytes keep flowing, so it must NOT time out.
            let url = serve_once(|mut s| async move {
                read_request(&mut s).await;
                s.write_all(HEADERS).await.unwrap();
                for _ in 0..6 {
                    s.write_all(b": OPENROUTER PROCESSING\n\n").await.unwrap();
                    s.flush().await.unwrap();
                    tokio::time::sleep(Duration::from_millis(60)).await;
                }
                s.write_all(DELTA).await.unwrap();
                s.write_all(DONE).await.unwrap();
                s.flush().await.unwrap();
            })
            .await;

            let chunks = collect(&url, fast()).await;

            assert_eq!(
                chunks,
                vec![
                    LlmChunk::TextDelta { delta: "hi".to_string() },
                    LlmChunk::Finish { reason: "stop".to_string(), usage: None, model: None },
                ]
            );
        }
    }
}
