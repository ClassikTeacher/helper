import { useState, type FormEvent } from 'react';

interface PromptInputProps {
  readonly disabled?: boolean;
  readonly onSubmit: (prompt: string) => void;
}

/**
 * Presentational: prompt box. Emits the prompt via callback — no logic inside.
 */
export function PromptInput({ disabled = false, onSubmit }: PromptInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        className="flex-1 rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
        placeholder="Ask about the screen…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Ask
      </button>
    </form>
  );
}
