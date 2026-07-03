import type { LlmPort, LlmMessage } from '@/core/application/ports/llm.port';

export interface SendPromptParams {
  readonly prompt: string;
  readonly signal?: AbortSignal;
}

/**
 * Use-case: send a plain text prompt (no screenshot) and stream the answer.
 * Model selection + provider failover live behind `LlmPort` (`ResilientLlm`),
 * so this use-case doesn't pick a model.
 */
export class SendPromptUseCase {
  constructor(private readonly llm: LlmPort) {}

  async *execute(params: SendPromptParams): AsyncIterable<string> {
    const messages: LlmMessage[] = [
      { role: 'user', parts: [{ kind: 'text', text: params.prompt }] },
    ];
    for await (const chunk of this.llm.stream({
      messages,
      ...(params.signal ? { signal: params.signal } : {}),
    })) {
      if (chunk.type === 'text-delta') yield chunk.delta;
      else if (chunk.type === 'error') throw new Error(chunk.message);
      // 'finish' carries reason/usage — nothing to emit to the text stream.
    }
  }
}
