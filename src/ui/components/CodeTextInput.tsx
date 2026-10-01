import { useState } from 'react';

interface CodeTextInputProps {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}

/**
 * Presentational: the "code as text" channel (R15). A toggle that reveals a
 * monospace textarea for pasting the exact code; when collapsed with content,
 * a compact chip shows how many lines are staged, plus a clear action. The
 * paste-code hotkey fills the same store field. No logic, no I/O.
 */
export function CodeTextInput({ value, disabled = false, onChange }: CodeTextInputProps) {
  const [open, setOpen] = useState(false);
  const lineCount = value.trim() ? value.replace(/\s+$/, '').split(/\r\n?|\n/).length : 0;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-300 hover:bg-neutral-700"
        >
          {'{ }'} Код текстом
        </button>
        {lineCount > 0 && (
          <>
            <span className="text-emerald-300">Код: {lineCount} строк</span>
            <button
              type="button"
              onClick={() => onChange('')}
              disabled={disabled}
              aria-label="Очистить код"
              className="text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
            >
              ✕
            </button>
          </>
        )}
      </div>
      {open && (
        <textarea
          aria-label="Код текстом"
          className="mt-2 h-32 w-full resize-y rounded-md bg-neutral-800 px-3 py-2 font-mono text-xs text-neutral-100 outline-none placeholder:text-neutral-500"
          placeholder="Вставьте код — он уйдёт в модель точным текстом вместе со скриншотами (или без них)."
          spellCheck={false}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
