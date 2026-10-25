import { useHudStore, type Dialog, type RunInfo } from '@/ui/store/hud.store';
import {
  compactHistory,
  type ConversationTurn,
  type SentPrompt,
} from '@/core/application/services/conversation-history';
import type { AppContainer } from './container.types';
import type { Agent, AgentId } from '@/core/domain/agent';
import type { ProgrammingLanguage } from '@/core/domain/language';
import type { Screenshot } from '@/core/domain/screenshot';
import type { LlmFinish } from '@/core/application/ports/llm.port';
import { abortReason, beginRun, endRun } from './run-control';

export interface AnalyzeAndStreamParams {
  /** Which agent (mode) to run. */
  readonly agent: Agent;
  /** Language hint for the solver; ignored by agents that don't need one. */
  readonly language: ProgrammingLanguage;
  /** Short instructions typed alongside the screenshots (may be empty). */
  readonly instructions: string;
  /** The staged screenshot batch to analyze (phase 8); empty/omitted → the use-case captures one fresh. */
  readonly screenshots?: readonly Screenshot[];
  /** The code as exact text (R15); with no screenshots the request is text-only. */
  readonly codeText?: string;
}

type RunUseCases = Pick<AppContainer['useCases'], 'analyzeScreenshot'> &
  Partial<Pick<AppContainer['useCases'], 'transcribeAudio'>>;

/**
 * Drives `AnalyzeScreenshotUseCase` and pipes its streamed deltas into the HUD
 * store. Deliberately a plain function, not a React hook — the hotkey wiring
 * (`bootstrap/hotkeys.ts`) needs the exact same start/append/finish/fail
 * sequence but runs outside any component (composition root, architecture.md
 * §8: platform wiring lives in bootstrap, never in UI). Reading/writing the
 * Zustand store via `getState()` works the same inside or outside React, so
 * both callers share one implementation instead of two copies drifting apart.
 *
 * The message continues the CURRENT dialog of its mode: the dialog so far is
 * replayed as context, and a successful answer is appended to it. A stopped or
 * failed run leaves the dialog as it was. Dialogs are in memory only — nothing
 * is written to disk (2026-10 review §2.4).
 */
export async function analyzeAndStream(useCases: RunUseCases, params: AnalyzeAndStreamParams): Promise<void> {
  const history = useHudStore.getState().dialogs[params.agent.id]?.turns ?? [];
  const wasRecording = useHudStore.getState().recording;
  const nothingStaged =
    (params.screenshots?.length ?? 0) === 0 && !params.codeText?.trim() && !params.instructions.trim();
  let sent: SentPrompt = { userText: '' };
  await streamRun({
    agentId: params.agent.id,
    hint: params.instructions.trim(),
    // If loopback recording is active (phase 9), stop it and transcribe BEFORE
    // streaming so the "transcribing…" spinner shows first and the transcript
    // rides along in the same request as the screenshots. An STT failure throws
    // here and is surfaced via `fail` — it does NOT get swallowed.
    prepare: () => collectTranscript(useCases),
    // An audio-only send whose recording turned out silent (nothing captured,
    // or the native silence gate dropped it — 2026-10 review §3.2) has no
    // question in it: don't spend a fresh capture + a model call on it, say so.
    check: (transcript) =>
      wasRecording && nothingStaged && !transcript.trim()
        ? 'В записи не распознано речи — отправлять нечего. Сделайте скриншот, вставьте код или запишите ещё раз.'
        : null,
    source: (transcript, hooks) =>
      useCases.analyzeScreenshot.execute({
        ...params,
        transcript,
        history,
        ...hooks,
        onPrompt: (prompt) => {
          sent = prompt;
        },
        onStatus: (status) => useHudStore.getState().setPhase(status),
        onNotice: (notice) => useHudStore.getState().setNotice(notice),
      }),
    turn: (answer) => ({ ...sent, answer }),
    onSuccess: () => {
      // Clear the live inputs only now that they have been successfully
      // applied, so neither the hint nor the pasted code silently sticks to
      // the NEXT batch (user decision 2026-07-04; R15). A FAILED run keeps
      // them intact so the user can just hit Run again.
      useHudStore.getState().setInstructions('');
      // Only if it is still the code this run sent: the paste-code hotkey works
      // while an answer streams, and code staged for the NEXT question must survive.
      if (useHudStore.getState().codeText === (params.codeText ?? '')) {
        useHudStore.getState().setCodeText('');
      }
    },
  });
}

/**
 * Sends a typed message with nothing attached (no screenshots, code, or audio)
 * into the current dialog of its mode — a follow-up on an earlier answer or a
 * standalone question — and streams the answer the same way as an analysis
 * (one active run, Stop, run info).
 */
export async function askAndStream(
  useCases: RunUseCases,
  params: { readonly agent: Agent; readonly language: ProgrammingLanguage; readonly question: string },
): Promise<void> {
  const question = params.question.trim();
  if (!question) return;
  const history = useHudStore.getState().dialogs[params.agent.id]?.turns ?? [];
  let sent: SentPrompt = { userText: '' };
  await streamRun({
    agentId: params.agent.id,
    hint: `↳ ${question}`,
    prepare: async () => '',
    source: (_transcript, hooks) =>
      useCases.analyzeScreenshot.ask({
        agent: params.agent,
        language: params.language,
        history,
        question,
        ...hooks,
        onPrompt: (prompt) => {
          sent = prompt;
        },
      }),
    turn: (answer) => ({ ...sent, answer }),
    onSuccess: () => useHudStore.getState().setInstructions(''),
  });
}

/**
 * Appends a completed exchange to the agent's dialog (starting one if there is
 * none) and keeps it bounded.
 */
function appendToDialog(agentId: AgentId, turn: ConversationTurn): void {
  const current = useHudStore.getState().dialogs[agentId];
  const dialog: Dialog = { turns: compactHistory([...(current?.turns ?? []), turn]) };
  useHudStore.getState().setDialog(agentId, dialog);
}

interface RunSpec {
  /** The mode whose dialog this message belongs to. */
  readonly agentId: AgentId;
  /** Shown in the HUD while the answer streams ("Hint" chip). */
  readonly hint: string;
  /** Work before streaming (e.g. STT); its result is handed to `source`. */
  readonly prepare: () => Promise<string>;
  /**
   * Last gate before anything is sent: given the prepared value, an error
   * message means "do not run" (shown via `fail`, the inputs stay intact).
   */
  readonly check?: (prepared: string) => string | null;
  readonly source: (
    prepared: string,
    hooks: { readonly signal: AbortSignal; readonly onFinish: (finish: LlmFinish) => void },
  ) => AsyncIterable<string>;
  /** The dialog turn for this message, given the completed answer. */
  readonly turn: (answer: string) => ConversationTurn;
  /** Extra bookkeeping after a successful answer (e.g. clearing the inputs). */
  readonly onSuccess: () => void;
}

/**
 * The shared run lifecycle: one active run (P0), stream into the HUD, report
 * run info (R9/R19), wind down on Stop/supersede; on success, append the
 * exchange to the mode's in-memory dialog.
 */
async function streamRun(spec: RunSpec): Promise<void> {
  // Exactly one active run (P0): starting this one aborts any run in flight.
  const signal = beginRun();
  try {
    const prepared = await spec.prepare();
    if (signal.aborted) return settleAborted(signal);
    const blocked = spec.check?.(prepared) ?? null;
    if (blocked) {
      useHudStore.getState().fail(blocked);
      return;
    }

    useHudStore.getState().startStreaming();
    // Display-only copy of what was applied to this run.
    useHudStore.getState().setActiveHint(spec.hint);

    for await (const delta of spec.source(prepared, {
      signal,
      onFinish: (finish) => useHudStore.getState().setLastRun(toRunInfo(finish)),
    })) {
      useHudStore.getState().appendAnswer(delta);
    }
    // Stopped or superseded: keep the inputs for a re-run, record nothing.
    if (signal.aborted) return settleAborted(signal);
    useHudStore.getState().finishStreaming();

    const answer = useHudStore.getState().answer;
    appendToDialog(spec.agentId, spec.turn(answer));
    spec.onSuccess();
  } catch (err) {
    if (signal.aborted) return settleAborted(signal);
    useHudStore.getState().fail(err instanceof Error ? err.message : String(err));
  } finally {
    endRun(signal);
  }
}

function toRunInfo(finish: LlmFinish): RunInfo {
  return {
    ...(finish.model ? { model: finish.model } : {}),
    fallback: finish.fallback ?? false,
    reason: finish.reason,
    ...(finish.usage
      ? {
          inputTokens: finish.usage.inputTokens,
          outputTokens: finish.usage.outputTokens,
          ...(finish.usage.cost !== undefined ? { cost: finish.usage.cost } : {}),
          ...(finish.usage.cachedTokens ? { cachedTokens: finish.usage.cachedTokens } : {}),
        }
      : {}),
  };
}

/**
 * Winds down an aborted run. A user Stop keeps the partial answer with a
 * "stopped" note; a superseded run leaves the HUD alone — the newer run
 * already reset and owns it.
 */
function settleAborted(signal: AbortSignal): void {
  if (abortReason(signal) === 'stop') useHudStore.getState().stopStreaming();
}

/**
 * If loopback recording is active, stop it and return the transcript; otherwise
 * return an empty string. Drives the `transcribing` spinner via the store. A
 * transcription failure is thrown to the caller (surfaced via `fail`) rather
 * than swallowed — the user should know the audio context was lost.
 */
async function collectTranscript(
  useCases: Partial<Pick<AppContainer['useCases'], 'transcribeAudio'>>,
): Promise<string> {
  const store = useHudStore.getState();
  if (!store.recording || !useCases.transcribeAudio) {
    // No audio this run: clear any transcript left over from a previous send so
    // the HUD preview doesn't imply audio is attached to THIS answer when it
    // isn't (the request below carries no transcript).
    if (store.transcript) store.setTranscript('');
    return '';
  }

  // Enter "transcribing" BEFORE the first await: a second send arriving while
  // stopRecording() is in flight must see it and back off (runSend), or it
  // would supersede this run and drain the audio into a run that is discarded.
  useHudStore.getState().startTranscribing();
  await useCases.transcribeAudio.stopRecording();
  const transcript = await useCases.transcribeAudio.transcribe();
  useHudStore.getState().setTranscript(transcript);
  return transcript;
}
