import type {
  LlmChunk,
  LlmContentPart,
  LlmMessage,
  LlmPort,
  LlmStreamRequest,
} from '@/core/application/ports/llm.port';

/**
 * Non-streaming OpenRouter `LlmPort` for the eval harness (R13). Plugged in
 * UNDER the real `ResilientLlm` + `AgentRunner`, so the eval exercises the
 * production prompt assembly and route-profile resolution; only the transport
 * differs from the app (fetch here, native `llm_stream` there).
 *
 * `buildRequestBody` MIRRORS `build_request_body` in
 * `src-tauri/src/infra/openrouter_client.rs` — keep them in sync (both are
 * covered by tests asserting the same shape: no max_tokens, temperature only
 * when set, reasoning excluded from the output).
 */

const URL = 'https://openrouter.ai/api/v1/chat/completions';

export function buildRequestBody(request: LlmStreamRequest): Record<string, unknown> {
  if (!request.model) throw new Error('eval OpenRouter port requires a concrete model');
  return {
    model: request.model,
    stream: false,
    usage: { include: true },
    messages: request.messages.map(toOpenAiMessage),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.reasoningEffort
      ? { reasoning: { effort: request.reasoningEffort, exclude: true } }
      : {}),
  };
}

function toOpenAiMessage(message: LlmMessage): Record<string, unknown> {
  if (message.role === 'system') {
    return {
      role: 'system',
      content: message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join(''),
    };
  }
  return { role: message.role, content: message.parts.map(toContentPart) };
}

function toContentPart(part: LlmContentPart): Record<string, unknown> {
  return part.kind === 'text'
    ? { type: 'text', text: part.text }
    : { type: 'image_url', image_url: { url: `data:image/png;base64,${part.imageBase64}` } };
}

interface CompletionResponse {
  model?: string;
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string };
}

export class OpenRouterFetchLlm implements LlmPort {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async *stream(request: LlmStreamRequest): AsyncIterable<LlmChunk> {
    let res: Response;
    try {
      res = await this.fetchImpl(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequestBody(request)),
        ...(request.signal ? { signal: request.signal } : {}),
      });
    } catch (e) {
      yield { type: 'error', message: `network: ${String(e)}`, retryable: true };
      return;
    }

    const body = (await res.json().catch(() => ({}))) as CompletionResponse;
    if (!res.ok || body.error) {
      yield {
        type: 'error',
        message: `OpenRouter HTTP ${res.status}: ${body.error?.message ?? ''}`,
        retryable: res.status >= 500 || [408, 409, 425, 429].includes(res.status),
      };
      return;
    }

    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (text) yield { type: 'text-delta', delta: text };
    yield {
      type: 'finish',
      reason: choice?.finish_reason ?? 'stop',
      ...(body.usage
        ? {
            usage: {
              inputTokens: body.usage.prompt_tokens ?? 0,
              outputTokens: body.usage.completion_tokens ?? 0,
              ...(body.usage.cost !== undefined ? { cost: body.usage.cost } : {}),
            },
          }
        : {}),
      ...(body.model ? { model: body.model } : {}),
    };
  }
}
