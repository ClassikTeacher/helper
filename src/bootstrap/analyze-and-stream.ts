import { useHudStore } from '@/ui/store/hud.store';
import type { AppContainer } from './container.types';
import type { Screenshot } from '@/core/domain/screenshot';

export interface AnalyzeAndStreamParams {
  readonly prompt: string;
  /** Reuse a pinned screenshot instead of letting the use-case capture a fresh one. */
  readonly screenshot?: Screenshot;
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
    Partial<Pick<AppContainer['useCases'], 'recordConversation'>>,
  params: AnalyzeAndStreamParams,
): Promise<void> {
  useHudStore.getState().startStreaming();
  try {
    for await (const delta of useCases.analyzeScreenshot.execute(params)) {
      useHudStore.getState().appendAnswer(delta);
    }
    useHudStore.getState().finishStreaming();

    // Persist the completed exchange (phase 4). Best-effort: a storage failure
    // must NOT break the answer already streamed to the user, so it's caught
    // and logged, never rethrown into the HUD.
    const answer = useHudStore.getState().answer;
    if (useCases.recordConversation && answer.trim()) {
      await useCases.recordConversation
        .execute({ prompt: params.prompt, answer })
        .catch((err) => console.error('Failed to persist conversation', err));
    }
  } catch (err) {
    useHudStore.getState().fail(err instanceof Error ? err.message : String(err));
  }
}
