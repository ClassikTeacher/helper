import type { LlmPort, LlmMessage } from '@/core/application/ports/llm.port';
import type { ModelRouter } from '@/core/application/services/model-router';
import type { TaskKind } from '@/core/domain/model-route';

export interface SendPromptParams {
  readonly prompt: string;
  readonly task?: TaskKind;
  readonly signal?: AbortSignal;
}

/**
 * Use-case: send a plain text prompt (no screenshot) and stream the answer.
 */
export class SendPromptUseCase {
  constructor(
    private readonly llm: LlmPort,
    private readonly modelRouter: ModelRouter,
  ) {}

  async *execute(params: SendPromptParams): AsyncIterable<string> {
    const route = this.modelRouter.route(params.task ?? 'quick-answer');
    const messages: LlmMessage[] = [
      { role: 'user', parts: [{ kind: 'text', text: params.prompt }] },
    ];
    for await (const chunk of this.llm.stream({
      model: route.model,
      messages,
      ...(params.signal ? { signal: params.signal } : {}),
    })) {
      if (chunk.type === 'text-delta') yield chunk.delta;
      else if (chunk.type === 'error') throw new Error(chunk.message);
      // 'finish' carries reason/usage — nothing to emit to the text stream.
    }
  }
}
