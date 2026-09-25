//! IPC DTOs — the Rust side of the webview <-> core contract seam.
//! MUST stay in sync with `src/core/contracts/dto.ts`. `camelCase` matches TS.

use serde::{Deserialize, Serialize};

/// Coordinates are PHYSICAL device pixels (matching the captured frame), not
/// logical/CSS pixels — see the DPI caveat in `infra/scap_capturer.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRegion {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    #[serde(default)]
    pub region: Option<CaptureRegion>,
    #[serde(default)]
    pub display_index: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    pub image_base64: String,
    pub width: u32,
    pub height: u32,
    /// Unix epoch milliseconds, UTC.
    pub captured_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRequest {
    pub image_base64: String,
    #[serde(default)]
    pub languages: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrBox {
    pub text: String,
    pub confidence: f32,
    // `box` is a Rust keyword, so the field is named `box_region` on this
    // side but serialized as `box` to match `OcrBoxDto.box` in dto.ts —
    // the wire shape is the single source of truth (architecture.md §3).
    #[serde(rename = "box")]
    pub box_region: CaptureRegion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub full_text: String,
    pub boxes: Vec<OcrBox>,
}

// --- LLM streaming (secure-native, `llm_stream`) ---------------------------
// Mirror of `core/contracts/dto.ts` LLM DTOs (phase 2). Frozen here ahead of
// the phase-2 command so the seam can't drift while the Rust side is unused.

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LlmRole {
    System,
    User,
    Assistant,
}

// `rename_all` renames the variant *tags* (Text -> "text", Image -> "image");
// `rename_all_fields` is what renames the *inner* fields (image_base64 ->
// "imageBase64"). Without the latter, the `Image` variant deserializes its
// field as snake_case `image_base64` and rejects the webview's camelCase
// `imageBase64`, failing with `missing field \`image_base64\``. The wire shape
// in `dto.ts` (LlmImagePartDto.imageBase64) is the source of truth.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum LlmContentPart {
    Text { text: String },
    Image { image_base64: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessage {
    pub role: LlmRole,
    pub parts: Vec<LlmContentPart>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmStreamRequest {
    /// OpenRouter model slug chosen by the resilient LLM layer (webview side).
    pub model: String,
    pub messages: Vec<LlmMessage>,
    /// Sampling temperature; `None` = not sent (provider default). Per route,
    /// chosen by the webview (R16). `f64` so `0.3` serializes as `0.3`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    /// OpenRouter `reasoning.effort` ("low" | "medium" | "high"); `None` = no
    /// reasoning requested (R16).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    /// Longest image edge in px; larger images are area-downscaled before the
    /// request (R4/R17). `None` = send as captured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_image_edge: Option<u32>,
    /// Client-generated id for `llm_cancel` (stop / superseded run). `None` =
    /// not cancellable (older webviews, tests).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// Payload of `llm_cancel`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmCancelRequest {
    pub request_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// USD cost reported by OpenRouter (`usage.cost`), when present (R9).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
}

/// Discriminated union streamed over `Channel<LlmChunk>`; terminal chunk is
/// `finish` or `error`. Mirror of `LlmChunkDto` in dto.ts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum LlmChunk {
    TextDelta {
        delta: String,
    },
    Finish {
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<LlmUsage>,
        /// Model slug the provider reports as having served the request (R19).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    Error {
        message: String,
        /// Whether this failure is worth retrying on a DIFFERENT model. The
        /// webview's resilient LLM layer uses it to decide whether to fail over
        /// to the next model in the chain. Mirrors `LlmError.retryable`
        /// (llm.port.ts) and the `LlmChunkDto` error variant (dto.ts).
        retryable: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretGetRequest {
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretGetResult {
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretSetRequest {
    pub key: String,
    pub value: String,
}

// --- Audio → STT (secure-native, phase 9) ----------------------------------
// The webview toggles recording via `audio_start_capture`/`audio_stop_capture`
// (no payload) and, at send time, calls `transcribe_audio` which returns this.
// The recorded audio itself never crosses the seam — only the text. Mirror of
// `TranscribeResultDto` in dto.ts.

/// Result of `audio_start_capture`: the rolling window the recording keeps
/// (the LAST `max_seconds`), so the HUD can tell the user.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStartResult {
    pub max_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    /// Recognized transcript (may be empty if nothing was captured).
    pub text: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Locks the webview <-> Rust wire shape for the image content part. The
    // webview (dto.ts: LlmImagePartDto) sends camelCase `imageBase64`; a serde
    // config renaming only the variant tag (not the inner field) regressed this
    // to snake_case `image_base64` and broke `llm_stream` with an "invalid args
    // `request` ... missing field `image_base64`" rejection.
    #[test]
    fn deserializes_camel_case_image_content_part_from_the_webview() {
        let json = r#"{
            "model": "anthropic/claude-haiku-4.5",
            "messages": [
                { "role": "user", "parts": [
                    { "kind": "text", "text": "describe" },
                    { "kind": "image", "imageBase64": "QUJD" }
                ] }
            ]
        }"#;

        let request: LlmStreamRequest = serde_json::from_str(json).unwrap();

        assert_eq!(request.model, "anthropic/claude-haiku-4.5");
        assert_eq!(request.messages[0].role, LlmRole::User);
        assert_eq!(
            request.messages[0].parts,
            vec![
                LlmContentPart::Text {
                    text: "describe".to_string()
                },
                LlmContentPart::Image {
                    image_base64: "QUJD".to_string()
                },
            ]
        );
    }

    #[test]
    fn serializes_image_content_part_back_to_camel_case() {
        let part = LlmContentPart::Image {
            image_base64: "QUJD".to_string(),
        };
        let value = serde_json::to_value(&part).unwrap();
        assert_eq!(value["kind"], "image");
        assert_eq!(value["imageBase64"], "QUJD");
    }

    #[test]
    fn request_profile_fields_are_optional_and_camel_case() {
        // Old webviews (no profile fields) must still deserialize.
        let bare: LlmStreamRequest =
            serde_json::from_str(r#"{ "model": "m", "messages": [] }"#).unwrap();
        assert_eq!(bare.temperature, None);
        assert_eq!(bare.reasoning_effort, None);
        assert_eq!(bare.max_image_edge, None);

        let full: LlmStreamRequest = serde_json::from_str(
            r#"{ "model": "m", "messages": [], "temperature": 0.3,
                 "reasoningEffort": "medium", "maxImageEdge": 2576 }"#,
        )
        .unwrap();
        assert_eq!(full.temperature, Some(0.3));
        assert_eq!(full.reasoning_effort.as_deref(), Some("medium"));
        assert_eq!(full.max_image_edge, Some(2576));
    }

    #[test]
    fn finish_chunk_serializes_model_and_cost_in_camel_case() {
        let chunk = LlmChunk::Finish {
            reason: "stop".to_string(),
            usage: Some(LlmUsage {
                input_tokens: 1,
                output_tokens: 2,
                cost: Some(0.5),
            }),
            model: Some("anthropic/claude-haiku-4.5".to_string()),
        };
        let value = serde_json::to_value(&chunk).unwrap();
        assert_eq!(value["type"], "finish");
        assert_eq!(value["usage"]["inputTokens"], 1);
        assert_eq!(value["usage"]["cost"], 0.5);
        assert_eq!(value["model"], "anthropic/claude-haiku-4.5");
    }
}
