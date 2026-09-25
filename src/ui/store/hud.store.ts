import { create } from 'zustand';
import type { Screenshot } from '@/core/domain/screenshot';
import type { AgentId } from '@/core/domain/agent';
import { DEFAULT_AGENT_ID } from '@/core/domain/agents-catalog';
import { DEFAULT_LANGUAGE, type ProgrammingLanguage } from '@/core/domain/language';

/**
 * Max screenshots the user can stage in one batch (phase 8). Capping keeps the
 * multimodal request bounded (each image inflates input tokens/cost) and the
 * preview strip readable.
 */
export const MAX_SCREENSHOTS = 5;

/**
 * What the HUD shows about the last completed run (R9/R19): the serving model,
 * whether it was a fallback, the finish reason, tokens and cost. Mirrors the
 * terminal `finish` chunk — kept as a UI-local shape so the store stays a
 * plain view model.
 */
export interface RunInfo {
  readonly model?: string;
  readonly fallback: boolean;
  /** Provider finish reason; `length` means the provider cut the answer short. */
  readonly reason: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** USD. */
  readonly cost?: number;
}

/**
 * UI-only state for the HUD (Zustand). No business logic, no domain data beyond
 * what the view needs to render. Domain results arrive from use-cases.
 *
 * The agent selection, language, and instructions live here (not in component
 * state) on purpose: the screenshot hotkey fires OUTSIDE React
 * (`bootstrap/hotkeys.ts`) and must read whatever the user currently has
 * selected/typed at capture time (user's requirement: "if the input box has
 * something during the screenshot, take it into account").
 */
interface HudState {
  readonly visible: boolean;
  readonly streaming: boolean;
  readonly answer: string;
  readonly error: string | null;
  /**
   * Staged screenshots to send as ONE batch (phase 8). The capture hotkey
   * appends (up to `MAX_SCREENSHOTS`); the send hotkey analyzes the whole
   * buffer at once. Was a single `screenshot` before phase 8.
   */
  readonly screenshots: readonly Screenshot[];
  /** Set when the global hotkey failed to register (e.g. taken by another app). */
  readonly hotkeyError: string | null;
  /** Selected agent/mode (solver or reviewer). */
  readonly agentId: AgentId;
  /** Selected language hint for the solver (ignored by the reviewer). */
  readonly language: ProgrammingLanguage;
  /** Short instructions typed in the input box, sent alongside the screenshots. */
  readonly instructions: string;
  /**
   * The hint actually applied to the current/last analysis (empty when none).
   * Distinct from `instructions` (the live input): the input is cleared after
   * each run so a hint never silently sticks to the next batch, while this
   * stays set so the UI can show that the answer used an extra hint.
   */
  readonly activeHint: string;
  /** True while loopback audio is being captured (phase 9). */
  readonly recording: boolean;
  /** True while the captured audio is being transcribed (phase 9). */
  readonly transcribing: boolean;
  /** The transcript applied to the current/last analysis (empty when none). */
  readonly transcript: string;
  /**
   * The code as exact text (R15), pasted into the HUD or taken from the
   * clipboard by the paste-code hotkey. Consumed by a successful run (like the
   * hints), so stale code never overrides the NEXT batch's screenshots.
   */
  readonly codeText: string;
  /** Model/usage/cost of the last completed run; null while streaming or before any run. */
  readonly lastRun: RunInfo | null;

  open(): void;
  close(): void;
  startStreaming(): void;
  appendAnswer(delta: string): void;
  finishStreaming(): void;
  fail(message: string): void;
  /**
   * Show an error WITHOUT the terminal side effects of `fail` (which also stops
   * the streaming/recording/transcribing indicators). For hotkey feedback that
   * must not disturb a run or a recording in progress.
   */
  setError(message: string | null): void;
  /** Append a screenshot to the batch (no-op once `MAX_SCREENSHOTS` is reached). */
  addScreenshot(screenshot: Screenshot): void;
  /** Drop the screenshot at `index` from the batch. */
  removeScreenshot(index: number): void;
  /** Empty the screenshot batch. */
  clearScreenshots(): void;
  setHotkeyError(message: string | null): void;
  setAgentId(agentId: AgentId): void;
  setLanguage(language: ProgrammingLanguage): void;
  setInstructions(instructions: string): void;
  setActiveHint(hint: string): void;
  /** Set the recording flag (record hotkey/button toggle). */
  setRecording(recording: boolean): void;
  /** Enter the transcribing state: recording stops, spinner shows, prior transcript cleared. */
  startTranscribing(): void;
  /** Store the finished transcript and clear the transcribing spinner. */
  setTranscript(transcript: string): void;
  setCodeText(codeText: string): void;
  setLastRun(info: RunInfo | null): void;
  reset(): void;
}

export const useHudStore = create<HudState>((set) => ({
  visible: false,
  streaming: false,
  answer: '',
  error: null,
  screenshots: [],
  hotkeyError: null,
  agentId: DEFAULT_AGENT_ID,
  language: DEFAULT_LANGUAGE,
  instructions: '',
  activeHint: '',
  recording: false,
  transcribing: false,
  transcript: '',
  codeText: '',
  lastRun: null,

  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
  startStreaming: () =>
    set({ streaming: true, answer: '', error: null, visible: true, lastRun: null }),
  appendAnswer: (delta) => set((s) => ({ answer: s.answer + delta })),
  finishStreaming: () => set({ streaming: false }),
  // Any terminal failure also clears the recording/transcribing flags — a failed
  // STT call (or a failed analyze after transcription) must not leave the "●
  // запись"/"расшифровка…" indicators stuck on when nothing is actually running.
  fail: (message) =>
    set({ streaming: false, recording: false, transcribing: false, error: message }),
  setError: (message) => set({ error: message }),
  addScreenshot: (screenshot) =>
    set((s) =>
      // Cap the batch: ignore extra captures past the limit rather than
      // dropping the oldest — the "N/MAX" counter tells the user it's full.
      s.screenshots.length >= MAX_SCREENSHOTS
        ? s
        : { screenshots: [...s.screenshots, screenshot], error: null },
    ),
  removeScreenshot: (index) =>
    set((s) => ({ screenshots: s.screenshots.filter((_, i) => i !== index) })),
  clearScreenshots: () => set({ screenshots: [] }),
  setHotkeyError: (message) => set({ hotkeyError: message }),
  setAgentId: (agentId) => set({ agentId }),
  setLanguage: (language) => set({ language }),
  setInstructions: (instructions) => set({ instructions }),
  setActiveHint: (hint) => set({ activeHint: hint }),
  setRecording: (recording) => set({ recording }),
  startTranscribing: () => set({ recording: false, transcribing: true, transcript: '', error: null }),
  setTranscript: (transcript) => set({ transcript, transcribing: false }),
  setCodeText: (codeText) => set({ codeText }),
  setLastRun: (lastRun) => set({ lastRun }),
  reset: () =>
    set({
      streaming: false,
      answer: '',
      error: null,
      screenshots: [],
      activeHint: '',
      recording: false,
      transcribing: false,
      transcript: '',
      codeText: '',
      lastRun: null,
    }),
}));
