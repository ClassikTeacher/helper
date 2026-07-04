import { LANGUAGE_OPTIONS, type ProgrammingLanguage } from '@/core/domain/language';

interface LanguageSelectProps {
  readonly value: ProgrammingLanguage;
  readonly disabled?: boolean;
  readonly onChange: (value: ProgrammingLanguage) => void;
}

/**
 * Presentational: a dropdown to pick the target programming language for the
 * solver agent. Only rendered when the selected agent needs a language hint
 * (the reviewer infers it from syntax), so it stays a dumb, controlled select.
 */
export function LanguageSelect({ value, disabled = false, onChange }: LanguageSelectProps) {
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-400">
      <span className="uppercase tracking-wide">Language</span>
      <select
        aria-label="Programming language"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ProgrammingLanguage)}
        className="rounded-md bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none disabled:opacity-50"
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
