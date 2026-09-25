//! `llm_stream` — secure-native LLM streaming command (phase 2). Thin adapter:
//! pulls the API key out of `SecretStore` (native-only, never serialized to
//! the webview) and delegates the HTTP/SSE mechanics to `OpenRouterClient`.
//! See architecture.md §3, §6, §11 and decisions.md "Спайк llm_stream".

use tauri::ipc::Channel;
use tauri::State;

use crate::dto::{LlmChunk, LlmStreamRequest};
use crate::infra::image::downscale_request_images;
use crate::AppState;

/// `SecretStore` key for the OpenRouter API key. MUST match
/// `SECRET_KEYS.openRouterApiKey` in `core/application/ports/secrets.port.ts`
/// — this string is the only thing tying the two sides together (there is no
/// shared enum across the Rust/TS seam for secret keys).
const OPENROUTER_API_KEY_SECRET: &str = "openrouter.api_key";

/// Always returns `Ok(())`: every failure (missing key, HTTP error, network
/// error, malformed stream) is delivered as a terminal `LlmChunk::Error` over
/// `channel` instead of a command rejection, so `TauriLlmAdapter` has a single
/// place (the channel) to look at for the outcome — see architecture.md §11.
#[tauri::command]
pub async fn llm_stream(
    state: State<'_, AppState>,
    request: LlmStreamRequest,
    channel: Channel<LlmChunk>,
) -> Result<(), String> {
    let api_key = match state.secrets.get(OPENROUTER_API_KEY_SECRET) {
        Ok(Some(key)) if !key.trim().is_empty() => key,
        Ok(_) => {
            // Missing key fails identically for every model — not retryable.
            let _ = channel.send(LlmChunk::Error {
                message: "OpenRouter API key is not set. Add it in settings.".to_string(),
                retryable: false,
            });
            return Ok(());
        }
        Err(e) => {
            // Keychain/OS error — same for every model, not retryable.
            let _ = channel.send(LlmChunk::Error {
                message: e,
                retryable: false,
            });
            return Ok(());
        }
    };

    // Per-request image cap (R4/R17): decode/resample/encode is CPU work, so
    // it runs off the async runtime. A failed join (panic) falls back to the
    // original request — an oversized image is better than no answer.
    let request = if request.max_image_edge.is_some() {
        let original = request.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let mut request = request;
            downscale_request_images(&mut request);
            request
        })
        .await
        .unwrap_or(original)
    } else {
        request
    };

    state.llm.stream_chat(&api_key, &request, &channel).await;
    Ok(())
}
