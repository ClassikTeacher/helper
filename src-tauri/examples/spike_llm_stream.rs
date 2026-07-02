//! Spike (Фаза 0.5, tasks.md): де-риск secure-native LLM-стриминга.
//!
//! Throwaway-код, но найденная механика (reqwest bytes_stream → ручной
//! SSE-парсер → `tauri::ipc::Channel<LlmChunkDto>`) — это ровно то, что
//! ляжет в прод-команду `llm_stream` в фазе 2 (см. architecture.md §3, §11).
//!
//! ВАЖНО: используется настоящий `tauri::ipc::Channel` (не мок) — тот же
//! тип, что примет webview в прод-команде. `Channel::new(...)` можно
//! создать без поднятого приложения/окна, поэтому спайк гоняет реальную
//! (де)сериализацию `LlmChunkDto` через `on_message`-колбэк, не поднимая
//! полный Tauri runtime.
//!
//! Запуск (ключ не хранится в репозитории — только переменная окружения на
//! время одного запуска):
//!   OPENROUTER_API_KEY=sk-or-v1-... cargo run --example spike_llm_stream
//! Опционально: OPENROUTER_MODEL=<slug> (по умолчанию openai/gpt-4o-mini —
//! дешёвая модель специально для спайка, не итоговый выбор роутера).

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::env;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

/// Зеркало прод-контракта `LlmChunk` из architecture.md §11: text-delta*
/// → ровно один терминальный finish (с usage) ИЛИ error.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum LlmChunkDto {
    TextDelta { delta: String },
    Finish { reason: String, usage: Option<UsageDto> },
    Error { message: String },
}

#[derive(Debug, Clone, Serialize)]
struct UsageDto {
    prompt_tokens: u32,
    completion_tokens: u32,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== spike: llm_stream (reqwest SSE → OpenRouter) через tauri::ipc::Channel ===");

    let api_key = match env::var("OPENROUTER_API_KEY") {
        Ok(k) if !k.trim().is_empty() => k,
        _ => {
            eprintln!("BLOCKER: переменная окружения OPENROUTER_API_KEY не задана.");
            eprintln!(
                "Запустите: OPENROUTER_API_KEY=sk-or-v1-... cargo run --example spike_llm_stream"
            );
            std::process::exit(1);
        }
    };
    let model = env::var("OPENROUTER_MODEL").unwrap_or_else(|_| "openai/gpt-4o-mini".to_string());
    println!("model: {model}");

    // Настоящий tauri::ipc::Channel — тот же тип, что примет webview-адаптер
    // (`TauriLlmAdapter`) в прод-команде `llm_stream`. on_message тут просто
    // логирует, но JSON-сериализация DTO проходит идентичный прод-пути путь.
    let received: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let received_clone = received.clone();
    let channel: Channel<LlmChunkDto> = Channel::new(move |body| {
        let json = match &body {
            InvokeResponseBody::Json(s) => s.clone(),
            InvokeResponseBody::Raw(_) => "<raw non-json body — неожиданно>".to_string(),
        };
        println!("  [Channel.send] {json}");
        received_clone.lock().unwrap().push(json);
        Ok(())
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .bearer_auth(&api_key)
        .json(&serde_json::json!({
            "model": model,
            "stream": true,
            "messages": [{"role": "user", "content": "Reply with exactly three words."}],
        }))
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        let _ = channel.send(LlmChunkDto::Error {
            message: format!("HTTP {status}: {body_text}"),
        });
        eprintln!("BLOCKER: OpenRouter вернул ошибку {status}: {body_text}");
        std::process::exit(1);
    }

    let mut buf = String::new();
    let mut delta_count = 0usize;
    let mut got_finish = false;
    let mut stream = resp.bytes_stream();

    'outer: while let Some(item) = stream.next().await {
        let bytes = item?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        // SSE-события разделены пустой строкой ("\n\n").
        while let Some(pos) = buf.find("\n\n") {
            let event = buf[..pos].to_string();
            buf.drain(..pos + 2);

            for line in event.lines() {
                let line = line.trim();
                // OpenRouter шлёт keep-alive комментарии вида ": OPENROUTER PROCESSING" — пропускаем.
                if line.is_empty() || line.starts_with(':') {
                    continue;
                }
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data == "[DONE]" {
                    got_finish = true;
                    channel.send(LlmChunkDto::Finish {
                        reason: "stop".into(),
                        usage: None,
                    })?;
                    break 'outer;
                }

                let v: Value = serde_json::from_str(data)?;
                if let Some(delta) = v["choices"][0]["delta"]["content"].as_str() {
                    if !delta.is_empty() {
                        delta_count += 1;
                        channel.send(LlmChunkDto::TextDelta {
                            delta: delta.to_string(),
                        })?;
                    }
                }
                if let Some(reason) = v["choices"][0]["finish_reason"].as_str() {
                    got_finish = true;
                    let usage = v.get("usage").and_then(|u| u.as_object()).map(|_| UsageDto {
                        prompt_tokens: v["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as u32,
                        completion_tokens: v["usage"]["completion_tokens"].as_u64().unwrap_or(0)
                            as u32,
                    });
                    channel.send(LlmChunkDto::Finish {
                        reason: reason.to_string(),
                        usage,
                    })?;
                    break 'outer;
                }
            }
        }
    }

    println!();
    println!("Итого text-delta чанков через Channel: {delta_count}");
    println!("Получен терминальный finish: {got_finish}");
    println!(
        "Всего сообщений принял on_message-колбэк канала: {}",
        received.lock().unwrap().len()
    );

    if delta_count == 0 || !got_finish {
        eprintln!(
            "BLOCKER: не получили ни одного text-delta, либо не дождались терминального finish"
        );
        std::process::exit(1);
    }

    println!("=== spike llm_stream: OK — механизм secure-native стриминга работает ===");
    Ok(())
}
