import { streamText, type CoreMessage } from 'ai';
import { createOpenRouter, type OpenRouterProvider } from '@openrouter/ai-sdk-provider';
import type { LlmChunk, LlmMessage, LlmPort, LlmStreamRequest } from '@/core/application/ports/llm.port';

/**
 * DEV-ONLY LlmPort over OpenRouter via the Vercel AI SDK, running IN THE WEBVIEW.
 *
 * ⚠️ Not for production. Per the secure-native decision (architecture.md §6,
 * decisions.md ADR #7) the real streaming path is the native `llm_stream`
 * command bridged by `TauriLlmAdapter`, so the API key never enters the
 * renderer. This adapter needs the key in webview memory and therefore only
 * exists for quick `pnpm dev` experiments against a throwaway key.
 */
export class OpenRouterLlmAdapter implements LlmPort {
  private readonly provider: OpenRouterProvider;

  constructor(apiKey: string) {
    this.provider = createOpenRouter({ apiKey });
  }

  async *stream(request: LlmStreamRequest): AsyncIterable<LlmChunk> {
    // `model` is optional on the port (ResilientLlm fills it per attempt); the
    // provider needs a concrete slug. ResilientLlm always sets it before here.
    if (!request.model) {
      throw new Error('OpenRouterLlmAdapter requires a concrete model slug (set by ResilientLlm)');
    }
    const result = streamText({
      model: this.provider(request.model),
      messages: request.messages.map(toCoreMessage),
      // Dev-only path: temperature is honored; reasoning and image downscaling
      // are native-only features (the production `llm_stream` path) and are
      // intentionally not emulated here.
      ...(request.temperature !== undefined && !request.reasoningEffort
        ? { temperature: request.temperature }
        : {}),
      ...(request.signal ? { abortSignal: request.signal } : {}),
    });

    try {
      for await (const delta of result.textStream) {
        yield { type: 'text-delta', delta };
      }
    } catch (error: unknown) {
      // Dev-only adapter: don't attempt cross-provider failover here (a single
      // throwaway dev key + AI-SDK error shapes make classification unreliable);
      // surface the error as non-retryable.
      yield {
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      };
      return;
    }

    const usage = await result.usage.catch(() => undefined);
    const reason = await result.finishReason.catch(() => 'stop' as const);
    yield {
      type: 'finish',
      reason,
      ...(usage ? { usage: { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens } } : {}),
    };
  }
}

function toCoreMessage(message: LlmMessage): CoreMessage {
  if (message.role === 'system') {
    const text = message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('');
    return { role: 'system', content: text };
  }

  const content = message.parts.map((part) =>
    part.kind === 'text'
      ? ({ type: 'text', text: part.text } as const)
      : ({ type: 'image', image: `data:image/png;base64,${part.imageBase64}` } as const),
  );

  // assistant messages carry text-only parts in practice.
  return { role: message.role, content } as CoreMessage;
}
