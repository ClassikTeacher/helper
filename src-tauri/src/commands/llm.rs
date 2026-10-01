//! `llm_stream` — secure-native LLM streaming command (phase 2). Thin adapter:
//! pulls the API key out of `SecretStore` (native-only, never serialized to
//! the webview) and delegates the HTTP/SSE mechanics to `OpenRouterClient`.
//! See architecture.md §3, §6, §11 and decisions.md "Спайк llm_stream".

use tauri::ipc::Channel;
use tauri::State;

use futures_util::future::{select, Either};

use crate::dto::{LlmCancelRequest, LlmChunk, LlmStreamRequest};
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

    // Cancellation (P0): the whole request — image preparation + streaming —
    // races against the request's cancel signal. Dropping the losing future
    // drops the HTTP response, closing the connection so generation stops
    // upstream. Requests without an id are simply not cancellable.
    let request_id = request.request_id.clone();
    let cancel = request_id.as_deref().map(|id| state.llm_cancels.register(id));

    let work = async {
        // Per-request image cap (R4/R17): decode/resample/encode is CPU work, so
        // it runs off the async runtime. The closure always hands the request
        // back (a panicking image worker is contained inside
        // `downscale_request_images`), so no defensive clone is needed.
        let request = if request.max_image_edge.is_some() {
            match tauri::async_runtime::spawn_blocking(move || {
                let mut request = request;
                downscale_request_images(&mut request);
                request
            })
            .await
            {
                Ok(request) => request,
                Err(e) => {
                    let _ = channel.send(LlmChunk::Error {
                        message: format!("image preparation failed: {e}"),
                        retryable: false,
                    });
                    return;
                }
            }
        } else {
            request
        };
        state.llm.stream_chat(&api_key, &request, &channel).await;
    };

    match cancel {
        Some(notify) => {
            let cancelled = std::pin::pin!(notify.notified());
            let work = std::pin::pin!(work);
            if let Either::Right(_) = select(work, cancelled).await {
                // The webview stopped listening already; a terminal chunk keeps
                // the channel contract (finish-or-error) intact regardless.
                let _ = channel.send(LlmChunk::Finish {
                    reason: "cancelled".to_string(),
                    usage: None,
                    model: None,
                });
            }
        }
        None => work.await,
    }

    if let Some(id) = request_id.as_deref() {
        state.llm_cancels.finish(id);
    }
    Ok(())
}

/// Stops an in-flight `llm_stream` (P0: the HUD's Stop / a superseding send).
/// Idempotent and race-safe — a cancel for a request that has not registered
/// yet is remembered (see `CancelRegistry`).
#[tauri::command]
pub fn llm_cancel(state: State<'_, AppState>, request: LlmCancelRequest) -> Result<(), String> {
    state.llm_cancels.cancel(&request.request_id);
    Ok(())
}
