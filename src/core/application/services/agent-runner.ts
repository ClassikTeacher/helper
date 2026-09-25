import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import type {
  LlmPort,
  LlmMessage,
  LlmContentPart,
  LlmFinish,
} from '@/core/application/ports/llm.port';
import type { Agent } from '@/core/domain/agent';
import type { ProgrammingLanguage } from '@/core/domain/language';
import type { Screenshot } from '@/core/domain/screenshot';
import { buildAgentPrompt, buildFollowUpText } from './agent-prompt';
import type { ScreenTranscriber } from './screen-transcriber';

export interface AgentRunnerDeps {
  readonly screenCapture: ScreenCapturePort;
  readonly llm: LlmPort;
  /** Optional screenshot → text pass (P1 item 7); applies per agent. */
  readonly transcriber?: ScreenTranscriber;
}

/** Progress the UI may show before the first answer token. */
export type RunStatus = 'reading-screen';

/** One completed exchange, kept as text for follow-up questions (P1 item 9). */
export interface ConversationTurn {
  /** The user text actually sent (data blocks included, images not). */
  readonly userText: string;
  readonly answer: string;
}

export interface FollowUpParams {
  readonly agent: Agent;
  /** Earlier exchanges of this session, oldest first. */
  readonly history: readonly ConversationTurn[];
  /** The user's follow-up question. */
  readonly question: string;
  readonly onPrompt?: (userText: string) => void;
  readonly onFinish?: (finish: LlmFinish) => void;
  readonly signal?: AbortSignal;
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
  /**
   * The code as exact text (R15), sent as a numbered `<code_text>` block. When
   * present and no screenshots are staged, NO fresh capture is taken — the
   * request is text-only (the user explicitly gave the code as text).
   */
  readonly codeText?: string;
  /**
   * Called with the terminal `finish` chunk (usage, cost, serving model,
   * finish reason) so the HUD can show it (R9/R19). The text stream itself
   * only carries deltas.
   */
  readonly onFinish?: (finish: LlmFinish) => void;
  /** Receives the user text that was sent — the start of a follow-up thread. */
  readonly onPrompt?: (userText: string) => void;
  /** Progress before streaming (e.g. the screen-transcription pass). */
  readonly onStatus?: (status: RunStatus) => void;
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
   * callers that don't stage a batch, e.g. the integration test, still work) —
   * unless `codeText` is given, in which case the request is text-only.
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
    const { screenCapture } = this.deps;

    // Analyze the staged batch; fall back to a single fresh capture when the
    // caller staged nothing (pre-phase-8 one-shot ergonomics — see the
    // `screenshots` doc comment) — except for a text-only code request.
    const hasCode = Boolean(params.codeText?.trim());
    const shots =
      params.screenshots && params.screenshots.length > 0
        ? params.screenshots
        : hasCode
          ? []
          : [await screenCapture.capture()];

    // Optional transcription pass (P1 item 7): only when the user gave no
    // text, there are screenshots, and the pass is enabled for this agent.
    let transcribed = '';
    const transcriber = this.deps.transcriber;
    if (!hasCode && shots.length > 0 && transcriber?.appliesTo(params.agent.id)) {
      params.onStatus?.('reading-screen');
      transcribed = await transcriber.transcribe(shots, params.signal);
      if (params.signal?.aborted) return;
    }

    const { system, userText } = buildAgentPrompt({
      agent: params.agent,
      language: params.language,
      instructions: params.instructions,
      ...(params.transcript ? { transcript: params.transcript } : {}),
      ...(hasCode && params.codeText
        ? { codeText: params.codeText }
        : transcribed
          ? { codeText: transcribed, codeTextSource: 'transcribed' as const }
          : {}),
      screenshotCount: shots.length,
    });
    params.onPrompt?.(userText);

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

    yield* this.stream(params.agent, messages, params);
  }

  /**
   * A follow-up question on the current thread (P1 item 9): system prompt,
   * then the earlier exchanges as plain text turns, then the question. The
   * screenshots are not re-sent — image tokens dominate the cost, and the
   * thread already carries the task statement, any code text and the answer.
   */
  async *followUp(params: FollowUpParams): AsyncIterable<string> {
    const userText = buildFollowUpText(params.question);
    params.onPrompt?.(userText);
    const text = (t: string): LlmContentPart[] => [{ kind: 'text', text: t }];
    const messages: LlmMessage[] = [
      { role: 'system', parts: text(params.agent.systemPrompt) },
      ...params.history.flatMap((turn): LlmMessage[] => [
        { role: 'user', parts: text(turn.userText) },
        { role: 'assistant', parts: text(turn.answer) },
      ]),
      { role: 'user', parts: text(userText) },
    ];
    yield* this.stream(params.agent, messages, params);
  }

  private async *stream(
    agent: Agent,
    messages: LlmMessage[],
    params: Pick<AnalyzeScreenParams, 'signal' | 'onFinish'>,
  ): AsyncIterable<string> {
    for await (const chunk of this.deps.llm.stream({
      // The agent declares its task weight; ResilientLlm resolves it (R11).
      route: agent.modelRoute,
      messages,
      ...(params.signal ? { signal: params.signal } : {}),
    })) {
      // Aborted (Stop / superseded): emit nothing more, even if the adapter
      // still hands over an already-buffered chunk.
      if (params.signal?.aborted) return;
      if (chunk.type === 'text-delta') yield chunk.delta;
      else if (chunk.type === 'error') throw new Error(chunk.message);
      // 'finish' carries reason/usage/model — reported out-of-band, not as text.
      else params.onFinish?.(chunk);
    }
  }
}
