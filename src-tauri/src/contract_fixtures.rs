//! Contract drift guard (2026-10 review §5.2).
//!
//! The IPC DTOs are mirrored by hand in `dto.rs` (serde) and `dto.ts`, and a
//! field renamed on one side only shows up at runtime (`OcrBox.box` vs
//! `boxRegion` and `imageBase64` vs `image_base64` both happened). This test
//! serializes a sample of every DTO that crosses the seam exactly as serde puts
//! it on the wire and writes them to `tests/contract/dto-fixtures.generated.ts`
//! as typed object literals. `pnpm typecheck` then rejects any sample whose
//! shape no longer matches the TS DTO: the type catches a missing/renamed
//! field, object-literal excess-property checking catches an extra one.
//!
//! The committed file must match what the current Rust code produces:
//!
//! ```text
//! UPDATE_CONTRACT_FIXTURES=1 cargo test --lib contract_fixtures   # regenerate
//! cargo test --lib contract_fixtures                               # verify (CI)
//! ```
//!
//! Command NAMES are guarded the same way by `tests/contract/ipc-commands.test.ts`
//! (`IPC_COMMANDS` ⇔ `generate_handler!`).

use serde::Serialize;
use serde_json::Value;

use crate::dto::*;

/// Path of the generated file, relative to the crate root.
const GENERATED_TS: &str = "../tests/contract/dto-fixtures.generated.ts";

/// One typed constant of the generated file.
struct Sample {
    /// Constant name (camelCase).
    name: &'static str,
    /// TS DTO type the literal must satisfy.
    ts_type: &'static str,
    value: Value,
}

fn sample<T: Serialize>(name: &'static str, ts_type: &'static str, value: &T) -> Sample {
    Sample {
        name,
        ts_type,
        value: serde_json::to_value(value).expect("DTO serializes"),
    }
}

/// Every DTO shape that crosses the seam, in both directions. Optional fields
/// are set so the sample shows the full shape; variants whose optional fields
/// are skipped when absent also get a minimal sample.
fn samples() -> Vec<Sample> {
    let region = CaptureRegion {
        x: 10,
        y: 20,
        width: 300,
        height: 200,
    };
    let text = |t: &str| LlmContentPart::Text { text: t.to_string() };

    vec![
        sample(
            "captureRequest",
            "CaptureRequestDto",
            &CaptureRequest {
                region: Some(region.clone()),
                display_index: Some(1),
                display_name: Some(r"\\.\DISPLAY2".to_string()),
                target: Some(CaptureTarget::ActiveWindow),
            },
        ),
        sample(
            "captureResult",
            "CaptureResultDto",
            &CaptureResult {
                image_base64: "QUJD".to_string(),
                width: 1568,
                height: 882,
                captured_at: 1_700_000_000_000,
                source: CaptureSource::Window,
            },
        ),
        sample(
            "ocrRequest",
            "OcrRequestDto",
            &OcrRequest {
                image_base64: "QUJD".to_string(),
                languages: Some(vec!["en".to_string(), "ru".to_string()]),
            },
        ),
        sample(
            "ocrResult",
            "OcrResultDto",
            &OcrResult {
                full_text: "fn main".to_string(),
                boxes: vec![OcrBox {
                    text: "fn".to_string(),
                    confidence: 0.5,
                    box_region: region,
                }],
            },
        ),
        sample(
            "llmStreamRequest",
            "LlmStreamRequestDto",
            &LlmStreamRequest {
                model: "anthropic/claude-haiku-4.5".to_string(),
                messages: vec![
                    LlmMessage {
                        role: LlmRole::System,
                        parts: vec![text("sys")],
                        cache: false,
                    },
                    LlmMessage {
                        role: LlmRole::User,
                        parts: vec![
                            LlmContentPart::Image {
                                image_base64: "QUJD".to_string(),
                            },
                            text("q"),
                        ],
                        cache: true,
                    },
                    LlmMessage {
                        role: LlmRole::Assistant,
                        parts: vec![text("a")],
                        cache: false,
                    },
                ],
                temperature: Some(0.3),
                reasoning_effort: Some("medium".to_string()),
                max_image_edge: Some(1568),
                request_id: Some("req-1".to_string()),
                provider: Some(ProviderPreference {
                    data_collection: DataCollection::Deny,
                    zdr: true,
                }),
            },
        ),
        sample(
            "llmCancelRequest",
            "LlmCancelRequestDto",
            &LlmCancelRequest {
                request_id: "req-1".to_string(),
            },
        ),
        sample(
            "llmChunkTextDelta",
            "LlmChunkDto",
            &LlmChunk::TextDelta {
                delta: "hi".to_string(),
            },
        ),
        sample(
            "llmChunkFinish",
            "LlmChunkDto",
            &LlmChunk::Finish {
                reason: "stop".to_string(),
                usage: Some(LlmUsage {
                    input_tokens: 12,
                    output_tokens: 34,
                    cost: Some(0.0021),
                    cached_tokens: Some(4096),
                }),
                model: Some("anthropic/claude-haiku-4.5".to_string()),
            },
        ),
        sample(
            "llmChunkFinishMinimal",
            "LlmChunkDto",
            &LlmChunk::Finish {
                reason: "cancelled".to_string(),
                usage: None,
                model: None,
            },
        ),
        sample(
            "llmChunkError",
            "LlmChunkDto",
            &LlmChunk::Error {
                message: "boom".to_string(),
                retryable: true,
            },
        ),
        sample(
            "secretKeyRequest",
            "SecretKeyRequestDto",
            &SecretKeyRequest {
                key: "openrouter.api_key".to_string(),
            },
        ),
        sample("secretHasResult", "SecretHasResultDto", &SecretHasResult { exists: true }),
        sample(
            "secretSetRequest",
            "SecretSetRequestDto",
            &SecretSetRequest {
                key: "openrouter.api_key".to_string(),
                value: "sk-or-v1-sample".to_string(),
            },
        ),
        sample(
            "audioStartRequest",
            "AudioStartRequestDto",
            &AudioStartRequest {
                window_secs: Some(90),
            },
        ),
        sample("audioStartResult", "AudioStartResultDto", &AudioStartResult { max_seconds: 60 }),
        sample(
            "transcribeRequest",
            "TranscribeRequestDto",
            &TranscribeRequest {
                language: Some("en".to_string()),
                prompt: Some("off".to_string()),
                silence_gate: Some(true),
                silence_dbfs: Some(-45.0),
            },
        ),
        sample(
            "transcribeResult",
            "TranscribeResultDto",
            &TranscribeResult {
                text: "привет".to_string(),
            },
        ),
        sample(
            "trayActionPayload",
            "TrayActionPayloadDto",
            &TrayActionPayload {
                action: "stop-recording".to_string(),
            },
        ),
        sample(
            "diagnosticsSnapshot",
            "DiagnosticsSnapshotDto",
            &DiagnosticsSnapshot {
                app_version: "0.0.0".to_string(),
                os: "windows".to_string(),
                arch: "x86_64".to_string(),
                log_path: r"C:\Users\me\AppData\Local\com.aihelper.app\logs\ai-helper.log".to_string(),
                log_tail: "[INFO] started\n".to_string(),
            },
        ),
    ]
}

fn render(samples: &[Sample]) -> String {
    let mut types: Vec<&str> = samples.iter().map(|s| s.ts_type).collect();
    types.sort_unstable();
    types.dedup();

    let mut out = String::new();
    out.push_str(
        "// GENERATED FILE — do not edit by hand.\n\
         // Produced by `UPDATE_CONTRACT_FIXTURES=1 cargo test --lib contract_fixtures`\n\
         // (src-tauri/src/contract_fixtures.rs) from the Rust DTOs exactly as serde puts\n\
         // them on the IPC wire. `pnpm typecheck` verifies every sample against the TS DTO:\n\
         // a renamed, missing or extra field fails the build (2026-10 review §5.2).\n",
    );
    out.push_str("import type {\n");
    for ts_type in &types {
        out.push_str(&format!("  {ts_type},\n"));
    }
    out.push_str("} from '@/core/contracts/dto';\n\n");
    for s in samples {
        let json = serde_json::to_string_pretty(&s.value).expect("JSON renders");
        out.push_str(&format!("export const {}: {} = {json};\n\n", s.name, s.ts_type));
    }
    out
}

#[test]
fn generated_ts_fixtures_match_the_rust_dtos() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(GENERATED_TS);
    let expected = render(&samples());

    if std::env::var_os("UPDATE_CONTRACT_FIXTURES").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &expected).unwrap();
        return;
    }

    // CRLF checkouts must not count as drift.
    let actual = std::fs::read_to_string(&path)
        .unwrap_or_default()
        .replace("\r\n", "\n");
    assert!(
        actual == expected,
        "{GENERATED_TS} does not match the Rust DTOs — regenerate with\n  \
         UPDATE_CONTRACT_FIXTURES=1 cargo test --lib contract_fixtures\n\
         and run `pnpm typecheck` to see which TS DTO drifted."
    );
}

#[test]
fn every_sample_names_a_distinct_constant() {
    let all = samples();
    let mut names: Vec<&str> = all.iter().map(|s| s.name).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), all.len());
}
