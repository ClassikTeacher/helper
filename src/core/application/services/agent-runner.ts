import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { LlmPort, LlmMessage } from '@/core/application/ports/llm.port';
import type { ModelRouter } from './model-router';
import type { TaskKind } from '@/core/domain/model-route';

export interface AgentRunnerDeps {
  readonly screenCapture: ScreenCapturePort;
  readonly llm: LlmPort;
  readonly modelRouter: ModelRouter;
}

export interface AnalyzeScreenParams {
  readonly prompt: string;
  readonly task?: TaskKind;
  readonly signal?: AbortSignal;
}

/**
 * Orchestrates the main scenario: capture the screen, route to a model, and
 * stream the answer. Depends only on ports + the pure router — no framework,
 * no Tauri, no fetch. Yields text deltas for the UI to render.
 */
export class AgentRunner {
  constructor(private readonly deps: AgentRunnerDeps) {}

  async *analyzeScreen(params: AnalyzeScreenParams): AsyncIterable<string> {
    const { screenCapture, llm, modelRouter } = this.deps;

    const shot = await screenCapture.capture();
    const route = modelRouter.route(params.task ?? 'vision');

    const messages: LlmMessage[] = [
      {
        role: 'user',
        parts: [
          { kind: 'text', text: params.prompt },
          { kind: 'image', imageBase64: shot.imageBase64 },
        ],
      },
    ];

    for await (const chunk of llm.stream({
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
