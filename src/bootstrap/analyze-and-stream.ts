import { useHudStore } from '@/ui/store/hud.store';
import { summarizeInvocation } from '@/core/application/services/agent-prompt';
import type { AppContainer } from './container.types';
import type { Agent } from '@/core/domain/agent';
import type { ProgrammingLanguage } from '@/core/domain/language';
import type { Screenshot } from '@/core/domain/screenshot';

export interface AnalyzeAndStreamParams {
  /** Which agent (mode) to run. */
  readonly agent: Agent;
  /** Language hint for the solver; ignored by agents that don't need one. */
  readonly language: ProgrammingLanguage;
  /** Short instructions typed alongside the screenshots (may be empty). */
  readonly instructions: string;
  /** The staged screenshot batch to analyze (phase 8); empty/omitted → the use-case captures one fresh. */
  readonly screenshots?: readonly Screenshot[];
}

/**
 * Drives `AnalyzeScreenshotUseCase` and pipes its streamed deltas into the HUD
 * store. Deliberately a plain function, not a React hook — the hotkey wiring
 * (`bootstrap/hotkeys.ts`) needs the exact same start/append/finish/fail
 * sequence but runs outside any component (composition root, architecture.md
 * §8: platform wiring lives in bootstrap, never in UI). Reading/writing the
 * Zustand store via `getState()` works the same inside or outside React, so
 * both callers share one implementation instead of two copies drifting apart.
 */
export async function analyzeAndStream(
  useCases: Pick<AppContainer['useCases'], 'analyzeScreenshot'> &
    Partial<Pick<AppContainer['useCases'], 'recordConversation' | 'transcribeAudio'>>,
  params: AnalyzeAndStreamParams,
): Promise<void> {
  try {
    // If loopback recording is active (phase 9), stop it and transcribe BEFORE
    // streaming so the "transcribing…" spinner shows first and the transcript
    // rides along in the same request as the screenshots. An STT failure throws
    // here and is surfaced via `fail` — it does NOT get swallowed or silently
    // drop the audio context.
    const transcript = await collectTranscript(useCases);

    useHudStore.getState().startStreaming();

    // Record the hint actually applied to this run so the UI can show it while
    // the answer streams. This is a display-only copy; the request already
    // carries `params.instructions`, so it doesn't affect what's sent.
    useHudStore.getState().setActiveHint(params.instructions.trim());

    for await (const delta of useCases.analyzeScreenshot.execute({ ...params, transcript })) {
      useHudStore.getState().appendAnswer(delta);
    }
    useHudStore.getState().finishStreaming();

    // Clear the live input only now that the hint has been successfully
    // applied, so it never silently sticks to the NEXT screenshot (user
    // decision 2026-07-04). Deliberately NOT done before the run: a FAILED
    // run keeps the input intact so the user can just hit Run again instead of
    // retyping the hint (the request captured `params.instructions` already).
    useHudStore.getState().setInstructions('');

    // Persist the completed exchange (phase 4). Best-effort: a storage failure
    // must NOT break the answer already streamed to the user, so it's caught
    // and logged, never rethrown into the HUD. The stored "prompt" is a short
    // summary of the invocation (agent + language + instructions) — the raw
    // system prompt would be noise in a history list.
    const answer = useHudStore.getState().answer;
    if (useCases.recordConversation && answer.trim()) {
      await useCases.recordConversation
        .execute({ prompt: summarizeInvocation(params), answer })
        .catch((err) => console.error('Failed to persist conversation', err));
    }
  } catch (err) {
    useHudStore.getState().fail(err instanceof Error ? err.message : String(err));
  }
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

  await useCases.transcribeAudio.stopRecording();
  useHudStore.getState().startTranscribing();
  const transcript = await useCases.transcribeAudio.transcribe();
  useHudStore.getState().setTranscript(transcript);
  return transcript;
}
