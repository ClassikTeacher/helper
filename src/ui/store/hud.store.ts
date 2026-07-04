import { create } from 'zustand';
import type { Screenshot } from '@/core/domain/screenshot';
import type { AgentId } from '@/core/domain/agent';
import { DEFAULT_AGENT_ID } from '@/core/domain/agents-catalog';
import { DEFAULT_LANGUAGE, type ProgrammingLanguage } from '@/core/domain/language';

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
  /** Latest captured screenshot to preview in the HUD (phase 1). */
  readonly screenshot: Screenshot | null;
  /** Set when the global hotkey failed to register (e.g. taken by another app). */
  readonly hotkeyError: string | null;
  /** Selected agent/mode (solver or reviewer). */
  readonly agentId: AgentId;
  /** Selected language hint for the solver (ignored by the reviewer). */
  readonly language: ProgrammingLanguage;
  /** Short instructions typed in the input box, sent alongside the screenshot. */
  readonly instructions: string;
  /**
   * The hint actually applied to the current/last analysis (empty when none).
   * Distinct from `instructions` (the live input): the input is cleared after
   * each run so a hint never silently sticks to the next screenshot, while this
   * stays set so the UI can show that the answer used an extra hint.
   */
  readonly activeHint: string;

  open(): void;
  close(): void;
  startStreaming(): void;
  appendAnswer(delta: string): void;
  finishStreaming(): void;
  fail(message: string): void;
  setScreenshot(screenshot: Screenshot): void;
  setHotkeyError(message: string | null): void;
  setAgentId(agentId: AgentId): void;
  setLanguage(language: ProgrammingLanguage): void;
  setInstructions(instructions: string): void;
  setActiveHint(hint: string): void;
  reset(): void;
}

export const useHudStore = create<HudState>((set) => ({
  visible: false,
  streaming: false,
  answer: '',
  error: null,
  screenshot: null,
  hotkeyError: null,
  agentId: DEFAULT_AGENT_ID,
  language: DEFAULT_LANGUAGE,
  instructions: '',
  activeHint: '',

  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
  startStreaming: () => set({ streaming: true, answer: '', error: null, visible: true }),
  appendAnswer: (delta) => set((s) => ({ answer: s.answer + delta })),
  finishStreaming: () => set({ streaming: false }),
  fail: (message) => set({ streaming: false, error: message }),
  setScreenshot: (screenshot) => set({ screenshot, error: null }),
  setHotkeyError: (message) => set({ hotkeyError: message }),
  setAgentId: (agentId) => set({ agentId }),
  setLanguage: (language) => set({ language }),
  setInstructions: (instructions) => set({ instructions }),
  setActiveHint: (hint) => set({ activeHint: hint }),
  reset: () => set({ streaming: false, answer: '', error: null, screenshot: null, activeHint: '' }),
}));
