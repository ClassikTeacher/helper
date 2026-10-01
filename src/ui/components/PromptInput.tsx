import { type FormEvent, type KeyboardEvent } from 'react';

interface PromptInputProps {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
}

/**
 * Presentational: the instructions box. Controlled by the store (its value must
 * be readable by the hotkey flow at capture time), so it takes `value`/`onChange`
 * and just emits `onSubmit` — no local state, no logic inside.
 *
 * A textarea, not a single-line input: the box carries not only short hints but
 * also whole code snippets pasted straight in (a send needs no screenshot when
 * this text is non-empty — see `runSend`), and a single-line input silently
 * flattens a multi-line paste into one line, wrecking the very code under
 * review. Enter still submits (the fast HUD ergonomics); Shift+Enter inserts a
 * newline for hand-typed multi-line input.
 */
export function PromptInput({ value, disabled = false, onChange, onSubmit }: PromptInputProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    onSubmit();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (disabled) return;
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <textarea
        // `rows={2}` + a max height keeps the HUD compact while long pastes stay
        // scrollable instead of pushing the answer off-screen.
        rows={2}
        className="max-h-32 flex-1 resize-y rounded-md bg-neutral-800 px-3 py-2 font-mono text-sm text-neutral-100 outline-none placeholder:font-sans placeholder:text-neutral-500"
        placeholder="Hints, or paste the code / task here (Shift+Enter — new line)…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Run
      </button>
    </form>
  );
}
