import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { LlmPort, LlmMessage, LlmContentPart } from '@/core/application/ports/llm.port';
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
   * The staged screenshot batch to analyze as one unit (phase 8). The capture
   * hotkey (`bootstrap/hotkeys.ts`) appends each shot to `hud.store.screenshots`
   * (while the HUD is content-protected, so the overlay never ends up in a
   * shot), and the send hotkey passes the whole buffer here. Each screenshot
   * becomes its own image content part, in order, before the text.
   *
   * When omitted or empty, the runner falls back to capturing a single fresh
   * screenshot — preserving the pre-phase-8 one-shot ergonomics (and letting
   * callers that don't stage a batch, e.g. the integration test, still work).
   */
  readonly screenshots?: readonly Screenshot[];
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

    // Analyze the staged batch; fall back to a single fresh capture when the
    // caller staged nothing (pre-phase-8 one-shot ergonomics — see the
    // `screenshots` doc comment).
    const shots =
      params.screenshots && params.screenshots.length > 0
        ? params.screenshots
        : [await screenCapture.capture()];

    const { system, userText } = buildAgentPrompt({
      agent: params.agent,
      language: params.language,
      instructions: params.instructions,
    });

    const messages: LlmMessage[] = [
      { role: 'system', parts: [{ kind: 'text', text: system }] },
      {
        role: 'user',
        // Images before text: the model attends best when the image(s) precede
        // the question (Anthropic vision guidance). Multiple shots are added in
        // capture order, so "screenshot 1..N" reads as one sequence, then the
        // text (language hint + instructions + answer-language directive) reads
        // as "given these screenshots, do X".
        parts: [
          ...shots.map((shot): LlmContentPart => ({ kind: 'image', imageBase64: shot.imageBase64 })),
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
