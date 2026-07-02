import { create } from 'zustand';
import type { Screenshot } from '@/core/domain/screenshot';

/**
 * UI-only state for the HUD (Zustand). No business logic, no domain data beyond
 * what the view needs to render. Domain results arrive from use-cases.
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

  open(): void;
  close(): void;
  startStreaming(): void;
  appendAnswer(delta: string): void;
  finishStreaming(): void;
  fail(message: string): void;
  setScreenshot(screenshot: Screenshot): void;
  setHotkeyError(message: string | null): void;
  reset(): void;
}

export const useHudStore = create<HudState>((set) => ({
  visible: false,
  streaming: false,
  answer: '',
  error: null,
  screenshot: null,
  hotkeyError: null,

  open: () => set({ visible: true }),
  close: () => set({ visible: false }),
  startStreaming: () => set({ streaming: true, answer: '', error: null, visible: true }),
  appendAnswer: (delta) => set((s) => ({ answer: s.answer + delta })),
  finishStreaming: () => set({ streaming: false }),
  fail: (message) => set({ streaming: false, error: message }),
  setScreenshot: (screenshot) => set({ screenshot, error: null }),
  setHotkeyError: (message) => set({ hotkeyError: message }),
  reset: () => set({ streaming: false, answer: '', error: null, screenshot: null }),
}));
