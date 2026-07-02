//! IPC DTOs — the Rust side of the webview <-> core contract seam.
//! MUST stay in sync with `src/core/contracts/dto.ts`. `camelCase` matches TS.

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LlmRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LlmContentPart {
    Text { text: String },
    Image { image_base64: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessage {
    pub role: LlmRole,
    pub parts: Vec<LlmContentPart>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmStreamRequest {
    /// OpenRouter model slug chosen by ModelRouter (webview side).
    pub model: String,
    pub messages: Vec<LlmMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Discriminated union streamed over `Channel<LlmChunk>`; terminal chunk is
/// `finish` or `error`. Mirror of `LlmChunkDto` in dto.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
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
