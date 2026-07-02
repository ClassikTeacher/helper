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
    const result = streamText({
      model: this.provider(request.model),
      messages: request.messages.map(toCoreMessage),
      ...(request.signal ? { abortSignal: request.signal } : {}),
    });

    try {
      for await (const delta of result.textStream) {
        yield { type: 'text-delta', delta };
      }
    } catch (error: unknown) {
      yield { type: 'error', message: error instanceof Error ? error.message : String(error) };
      return;
    }

    const usage = await result.usage.catch(() => undefined);
    yield {
      type: 'finish',
      reason: 'stop',
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
