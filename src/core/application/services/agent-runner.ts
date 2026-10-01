import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type { LlmPort, LlmMessage, LlmContentPart, LlmUsage } from '@/core/application/ports/llm.port';
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
  /**
   * Transcript of the interlocutor's speech (loopback STT, phase 9). Sent as a
   * labeled data block in the user text alongside the screenshots. May be empty.
   */
  readonly transcript?: string;
  readonly signal?: AbortSignal;
  /**
   * Called once with the provider's token/cost accounting when the stream
   * finishes and the provider reported it (usage observability — see
   * agents-improvement.md R9). Optional: callers that don't display usage
   * simply omit it. Kept as a callback because the generator's yield type
   * stays a plain text delta for the UI.
   */
  readonly onUsage?: (usage: LlmUsage) => void;
  /**
   * The staged screenshot batch to analyze as one unit (phase 8). The capture
   * hotkey (`bootstrap/hotkeys.ts`) appends each shot to `hud.store.screenshots`
   * (while the HUD is content-protected, so the overlay never ends up in a
   * shot), and the send hotkey passes the whole buffer here. Each screenshot
   * becomes its own image content part, in order, before the text.
   *
   * When omitted or empty, the runner falls back to capturing a single fresh
   * screenshot — preserving the pre-phase-8 one-shot ergonomics (and letting
   * callers that don't stage a batch, e.g. the integration test, still work),
   * unless `captureIfEmpty` is false.
   */
  readonly screenshots?: readonly Screenshot[];
  /**
   * Whether an empty `screenshots` batch should trigger the fresh-capture
   * fallback. Defaults to true. Callers set it to false for a TEXT-ONLY send:
   * the user pasted the code/task into the input and staged no shots, so the
   * screen holds nothing relevant — grabbing it would only feed the model
   * noise. The run then carries no image parts at all.
   */
  readonly captureIfEmpty?: boolean;
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
    const { llm } = this.deps;

    // Analyze the staged batch; fall back to a single fresh capture when the
    // caller staged nothing (pre-phase-8 one-shot ergonomics — see the
    // `screenshots` doc comment), except on a text-only send.
    const shots = await this.resolveShots(params);

    const { system, userText } = buildAgentPrompt({
      agent: params.agent,
      language: params.language,
      instructions: params.instructions,
      hasScreenshots: shots.length > 0,
      ...(params.transcript ? { transcript: params.transcript } : {}),
    });

    const messages: LlmMessage[] = [
      { role: 'system', parts: [{ kind: 'text', text: system }] },
      {
        role: 'user',
        // Images before text: the model attends best when the image(s) precede
        // the question (Anthropic vision guidance). Multiple shots are added in
        // capture order, so "screenshot 1..N" reads as one sequence, then the
        // text (language hint + instructions + answer-language directive) reads
        // as "given these screenshots, do X". On a text-only send there are no
        // image parts and the text stands alone.
        parts: [
          ...shots.map((shot): LlmContentPart => ({ kind: 'image', imageBase64: shot.imageBase64 })),
          { kind: 'text', text: userText },
        ],
      },
    ];

    for await (const chunk of llm.stream({
      messages,
      // The agent names the WEIGHT of the work (light/heavy); `ResilientLlm`
      // turns that into a concrete model chain. The runner still doesn't pick
      // a model — see `ModelRoute`.
      route: params.agent.modelRoute,
      ...(params.signal ? { signal: params.signal } : {}),
    })) {
      if (chunk.type === 'text-delta') yield chunk.delta;
      else if (chunk.type === 'error') throw new Error(chunk.message);
      // 'finish' emits nothing to the text stream; its usage (when the
      // provider reported one) is surfaced via the optional callback.
      else if (chunk.usage) params.onUsage?.(chunk.usage);
    }
  }

  /**
   * The images for this run: the staged batch, a single fresh capture when the
   * caller staged nothing, or none at all on a text-only send.
   */
  private async resolveShots(params: AnalyzeScreenParams): Promise<readonly Screenshot[]> {
    if (params.screenshots && params.screenshots.length > 0) return params.screenshots;
    if (params.captureIfEmpty === false) return [];
    return [await this.deps.screenCapture.capture()];
  }
}
