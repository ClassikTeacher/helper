import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { LlmPort, LlmMessage } from '@/core/application/ports/llm.port';
import type { ModelRouter } from './model-router';
import type { TaskKind } from '@/core/domain/model-route';
import type { Screenshot } from '@/core/domain/screenshot';

export interface AgentRunnerDeps {
  readonly screenCapture: ScreenCapturePort;
  readonly llm: LlmPort;
  readonly modelRouter: ModelRouter;
}

export interface AnalyzeScreenParams {
  readonly prompt: string;
  readonly task?: TaskKind;
  readonly signal?: AbortSignal;
  /**
   * Reuse an already-captured screenshot instead of capturing a fresh one.
   * The hotkey flow (`bootstrap/hotkeys.ts`) captures once (while the HUD is
   * still hidden, so the overlay itself never ends up in the shot) and pins
   * it to `hud.store.screenshot`; a second, independent capture here — e.g.
   * triggered later by a follow-up question typed in `PromptInput` — would
   * both waste a capture AND risk framing the now-visible HUD itself, since
   * nothing hides it for that second shot. Omit only when no screenshot has
   * been pinned yet.
   */
  readonly screenshot?: Screenshot;
}

/**
 * Orchestrates the main scenario: capture the screen (or reuse a pinned one),
 * route to a model, and stream the answer. Depends only on ports + the pure
 * router — no framework, no Tauri, no fetch. Yields text deltas for the UI to
 * render.
 */
export class AgentRunner {
  constructor(private readonly deps: AgentRunnerDeps) {}

  async *analyzeScreen(params: AnalyzeScreenParams): AsyncIterable<string> {
    const { screenCapture, llm, modelRouter } = this.deps;

    const shot = params.screenshot ?? (await screenCapture.capture());
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
