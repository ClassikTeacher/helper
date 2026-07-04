import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { LlmPort, LlmMessage } from '@/core/application/ports/llm.port';
import type { Agent } from '@/core/domain/agent';
import type { ProgrammingLanguage } from '@/core/domain/language';
import type { Screenshot } from '@/core/domain/screenshot';
import { buildAgentPrompt } from './agent-prompt';

export interface AgentRunnerDeps {
  readonly screenCapture: ScreenCapturePort;
  readonly llm: LlmPort;
}

export interface AnalyzeScreenParams {
  /** Which agent (mode) to run — solver or reviewer. */
  readonly agent: Agent;
  /** Language hint for the solver; ignored when the agent doesn't need one. */
  readonly language: ProgrammingLanguage;
  /** Short free-text hints from the input box (may be empty). */
  readonly instructions: string;
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
 * build the selected agent's prompt, and stream the answer. Depends only on
 * ports — no framework, no Tauri, no fetch. Model selection + provider failover
 * live in the `ResilientLlm` layer behind `LlmPort`, so the runner just streams
 * and doesn't choose a model. Yields text deltas for the UI to render.
 */
export class AgentRunner {
  constructor(private readonly deps: AgentRunnerDeps) {}

  async *analyzeScreen(params: AnalyzeScreenParams): AsyncIterable<string> {
    const { screenCapture, llm } = this.deps;

    const shot = params.screenshot ?? (await screenCapture.capture());
    const { system, userText } = buildAgentPrompt({
      agent: params.agent,
      language: params.language,
      instructions: params.instructions,
    });

    const messages: LlmMessage[] = [
      { role: 'system', parts: [{ kind: 'text', text: system }] },
      {
        role: 'user',
        // Image before text: for a single-image prompt the model attends best
        // when the image precedes the question (Anthropic vision guidance). The
        // accompanying text (language hint + instructions + answer-language
        // directive) then reads as "given this screenshot, do X".
        parts: [
          { kind: 'image', imageBase64: shot.imageBase64 },
          { kind: 'text', text: userText },
        ],
      },
    ];

    for await (const chunk of llm.stream({
      messages,
      ...(params.signal ? { signal: params.signal } : {}),
    })) {
      if (chunk.type === 'text-delta') yield chunk.delta;
      else if (chunk.type === 'error') throw new Error(chunk.message);
      // 'finish' carries reason/usage — nothing to emit to the text stream.
    }
  }
}
