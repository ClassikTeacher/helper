import { create } from 'zustand';

/**
 * UI-only state for the HUD (Zustand). No business logic, no domain data beyond
 * what the view needs to render. Domain results arrive from use-cases.
 */
interface HudState {
  readonly visible: boolean;
  readonly streaming: boolean;
  readonly answer: string;
  readonly error: string | null;
  /** Set when the global hotkey failed to register (e.g. taken by another app). */
  readonly hotkeyError: string | null;

  open(): void;
  close(): void;
  startStreaming(): void;
  appendAnswer(delta: string): void;
  finishStreaming(): void;
  fail(message: string): void;
  setHotkeyError(message: string | null): void;
  reset(): void;
}

export const useHudStore = create<HudState>((set) => ({
  visible: false,
  streaming: false,
  answer: '',
  error: null,
  hotkeyError: null,

  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
  startStreaming: () => set({ streaming: true, answer: '', error: null, visible: true }),
  appendAnswer: (delta) => set((s) => ({ answer: s.answer + delta })),
  finishStreaming: () => set({ streaming: false }),
  fail: (message) => set({ streaming: false, error: message }),
  setHotkeyError: (message) => set({ hotkeyError: message }),
  reset: () => set({ streaming: false, answer: '', error: null }),
}));
