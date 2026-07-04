/**
 * Programming languages the solver agent can target. Pure domain — no I/O.
 *
 * `'all'` means "not specified": the user hasn't pinned a language, so the model
 * infers it from the screenshot (a bare text task may not name one). The order
 * below is the exact order the selector renders in (product decision).
 */
export type ProgrammingLanguage =
  | 'all'
  | 'js'
  | 'ts'
  | 'go'
  | 'python'
  | 'sql'
  | 'csharp'
  | 'java'
  | 'kotlin'
  | 'swift';

export interface LanguageOption {
  readonly value: ProgrammingLanguage;
  readonly label: string;
}

/** Ordered list backing the language selector (order is intentional). */
export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { value: 'all', label: 'Auto / Any' },
  { value: 'js', label: 'JavaScript' },
  { value: 'ts', label: 'TypeScript' },
  { value: 'go', label: 'Go' },
  { value: 'python', label: 'Python' },
  { value: 'sql', label: 'SQL' },
  { value: 'csharp', label: 'C#' },
  { value: 'java', label: 'Java' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'swift', label: 'Swift' },
];

/** Default: language unspecified — let the model infer it from the screenshot. */
export const DEFAULT_LANGUAGE: ProgrammingLanguage = 'all';

const LABELS: Readonly<Record<ProgrammingLanguage, string>> = Object.fromEntries(
  LANGUAGE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<ProgrammingLanguage, string>;

/** Human-readable label for a language value, used when building the prompt. */
export function languageLabel(value: ProgrammingLanguage): string {
  return LABELS[value];
}
