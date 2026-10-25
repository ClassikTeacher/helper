import type { ReactNode } from 'react';

export const INPUT_CLASS =
  'w-full rounded-md bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 disabled:opacity-50';

export const SMALL_BUTTON_CLASS =
  'rounded border border-neutral-600 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50';

interface FieldProps {
  readonly label: string;
  readonly htmlFor?: string | undefined;
  readonly hint?: string | undefined;
  /** Validation message for this field (from `SettingsErrors`), if any. */
  readonly error?: string | undefined;
  readonly children: ReactNode;
}

/** One labelled form row with an optional hint and a validation message. */
export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="mb-2">
      <label htmlFor={htmlFor} className="mb-1 block text-xs text-neutral-400">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-0.5 text-[10px] text-neutral-500">{hint}</p>}
      {error && (
        <p role="alert" className="mt-0.5 text-[10px] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** `""` → NaN (so validation flags an empty number), otherwise the number. */
export function numberFromInput(value: string): number {
  const trimmed = value.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}
