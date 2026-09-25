import { type FormEvent } from 'react';

interface PromptInputProps {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void;
  /**
   * Follow-up on the current answer (P1 item 9). The button shows only when a
   * thread exists; the typed text is then the follow-up question.
   */
  readonly onFollowUp?: () => void;
  readonly canFollowUp?: boolean;
}

/**
 * Presentational: the instructions box. Controlled by the store (its value must
 * be readable by the hotkey flow at capture time), so it takes `value`/`onChange`
 * and just emits `onSubmit` — no local state, no logic inside.
 *
 * The text is optional short hints (e.g. a framework or constraint) sent
 * alongside the screenshot; submitting re-runs the analysis on the pinned shot.
 */
export function PromptInput({
  value,
  disabled = false,
  onChange,
  onSubmit,
  onFollowUp,
  canFollowUp = false,
}: PromptInputProps) {
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
          canFollowUp
            ? 'Подсказка к новому анализу или вопрос-уточнение…'
            : 'Optional hints (framework, constraints)…'
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
      {canFollowUp && onFollowUp && (
        <button
          type="button"
          onClick={onFollowUp}
          disabled={disabled || !value.trim()}
          title="Задать уточняющий вопрос к текущему ответу"
          className="rounded-md border border-indigo-600 px-3 py-2 text-sm font-medium text-indigo-300 disabled:opacity-50"
        >
          ↳ Уточнить
        </button>
      )}
    </form>
  );
}
