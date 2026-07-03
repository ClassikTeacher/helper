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
    /// OpenRouter model slug chosen by ModelRouter (webview side).
    pub model: String,
    pub messages: Vec<LlmMessage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
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
    },
    Error {
        message: String,
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
}
