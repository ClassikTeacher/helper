/**
 * Prompt-eval data model (R3/R13). See docs/prompt-eval/README.md.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Weighted recall (R13): missing a process-crashing race must cost more than
 * missing a deprecated call. Plain recall treated them as equal, so a run that
 * found only nitpicks could outscore one that found the Criticals.
 */
export const SEVERITY_WEIGHT: Readonly<Record<Severity, number>> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0.5,
};

export interface GroundTruthFinding {
  readonly id: string;
  readonly severity: Severity;
  /** Where the item came from (e.g. `sonnet5-chat`, `review-2026-09`, `seeded`). */
  readonly origin: string;
  /** Inclusive 1-based line range in the case source. */
  readonly lines: readonly [number, number];
  readonly title: string;
  readonly detail: string;
}

/** How an arm feeds the case to the agent. `shot+ocr` = screenshots + the transcription pass (P1 item 7). */
export type InputMode = 'text' | 'shot' | 'text+shot' | 'shot+ocr';

export interface EvalCase {
  readonly id: string;
  /**
   * `review` (default): `findings` are DEFECTS the review must find.
   * `solve`: `findings` are CRITERIA a correct answer must satisfy.
   */
  readonly kind?: 'review' | 'solve';
  readonly agent: 'solver' | 'reviewer';
  /** Solver language selector value (`all` = infer); ignored by the reviewer. */
  readonly language: string;
  /** Input modes that make sense for this case (default: all). */
  readonly inputs?: readonly InputMode[];
  /** Rendering overrides for `pnpm eval:shots`. */
  readonly render?: { readonly splitEvery?: number };
  /** Source file name inside the case directory. */
  readonly source: string;
  /** Held-out cases are never used to tune prompts — only to check them. */
  readonly heldOut: boolean;
  readonly notes: string;
  readonly findings: readonly GroundTruthFinding[];
}

export type Coverage = 'full' | 'partial' | 'miss';

export type ClaimVerdict = 'valid_extra' | 'false_positive' | 'neutral';

/** What the LLM judge returns for one answer. */
export interface JudgeVerdict {
  /** Coverage per ground-truth id; ids the judge omitted count as `miss`. */
  readonly coverage: Readonly<Record<string, Coverage>>;
  /** Issues raised by the answer that do NOT map to a ground-truth id. */
  readonly claims: readonly {
    readonly text: string;
    readonly verdict: ClaimVerdict;
    readonly reason?: string;
  }[];
}

export interface AnchorStats {
  /** «quotes» found / how many occur verbatim in the source. */
  readonly quotes: { readonly total: number; readonly valid: number };
  /** Line references found / verified / could not be verified (no code token nearby). */
  readonly lines: { readonly total: number; readonly valid: number; readonly unverifiable: number };
}
