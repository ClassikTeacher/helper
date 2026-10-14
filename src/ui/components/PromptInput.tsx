import { type FormEvent } from 'react';

interface PromptInputProps {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  /** The current mode's dialog already has messages — the next one continues it. */
  readonly continuing?: boolean;
}

/**
 * Presentational: the input box. Controlled by the store (its value must be
 * readable by the hotkey flow at capture time), so it takes `value`/`onChange`
 * and just emits `onSubmit` — no local state, no logic inside.
 *
 * The text rides along with the staged screenshots/code as hints, or — when
 * nothing else is staged — is sent on its own as a question in the dialog.
 */
export function PromptInput({ value, disabled = false, onChange, onSubmit, continuing = false }: PromptInputProps) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        className="flex-1 rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
        placeholder={
          continuing
            ? 'Вопрос или подсказка — продолжение диалога…'
            : 'Подсказка к скриншоту или вопрос…'
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
