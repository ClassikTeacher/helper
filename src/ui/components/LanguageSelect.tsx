import { useEffect, useRef, useState } from 'react';
import { LANGUAGE_OPTIONS, languageLabel, type ProgrammingLanguage } from '@/core/domain/language';

interface LanguageSelectProps {
  readonly value: ProgrammingLanguage;
  readonly disabled?: boolean;
  readonly onChange: (value: ProgrammingLanguage) => void;
}

/**
 * Presentational: a dropdown to pick the target programming language for the
 * solver agent. Only rendered when the selected agent needs a language hint
 * (the reviewer infers it from syntax), so it stays a dumb, controlled widget.
 *
 * NB: implemented as a *custom* in-DOM dropdown, NOT a native `<select>`, on
 * purpose. The HUD window is excluded from screen capture (`contentProtected` /
 * `WDA_EXCLUDEFROMCAPTURE`), but a native `<select>` renders its open option
 * list as a separate OS-level popup window that is NOT a child of the protected
 * WebView window — so the list leaked into screen shares / recordings / demos
 * (only the options were visible, the HUD itself stayed hidden). Rendering the
 * options inside the WebView DOM keeps them within the protected window.
 */
export function LanguageSelect({ value, disabled = false, onChange }: LanguageSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = (next: ProgrammingLanguage) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative flex items-center gap-2 text-xs text-neutral-400">
      <span className="uppercase tracking-wide">Language</span>
      <button
        type="button"
        aria-label="Programming language"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="min-w-[7rem] rounded-md bg-neutral-800 px-2 py-1 text-left text-sm text-neutral-100 outline-none disabled:opacity-50"
      >
        {languageLabel(value)}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Programming language"
          className="absolute right-0 top-full z-10 mt-1 max-h-64 w-40 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-800 py-1 shadow-xl"
        >
          {LANGUAGE_OPTIONS.map((option) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => select(option.value)}
                  className={`block w-full px-3 py-1.5 text-left text-sm ${
                    isSelected ? 'bg-indigo-600 text-white' : 'text-neutral-100 hover:bg-neutral-700'
                  }`}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
