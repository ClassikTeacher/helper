import {
  SEVERITY_WEIGHT,
  type AnchorStats,
  type Coverage,
  type GroundTruthFinding,
  type JudgeVerdict,
} from './types';

/**
 * Deterministic scoring for the prompt eval (R13). Pure functions — no I/O —
 * unit-tested in tests/unit/eval-scoring.test.ts.
 */

const COVERAGE_SCORE: Readonly<Record<Coverage, number>> = { full: 1, partial: 0.5, miss: 0 };

/**
 * Σ weight × coverage / Σ weight over the given findings (default: all).
 * `partial` counts half, as in the original baseline methodology.
 */
export function weightedRecall(
  findings: readonly GroundTruthFinding[],
  verdict: Pick<JudgeVerdict, 'coverage'>,
): number {
  const total = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
  if (total === 0) return 0;
  const got = findings.reduce(
    (sum, f) => sum + SEVERITY_WEIGHT[f.severity] * COVERAGE_SCORE[verdict.coverage[f.id] ?? 'miss'],
    0,
  );
  return got / total;
}

/** Unweighted `(full + 0.5 × partial) / n` — the metric of the 2026-08-27 baseline. */
export function plainRecall(
  findings: readonly GroundTruthFinding[],
  verdict: Pick<JudgeVerdict, 'coverage'>,
): number {
  if (findings.length === 0) return 0;
  const got = findings.reduce((sum, f) => sum + COVERAGE_SCORE[verdict.coverage[f.id] ?? 'miss'], 0);
  return got / findings.length;
}

export function countClaims(verdict: JudgeVerdict, kind: JudgeVerdict['claims'][number]['verdict']): number {
  return verdict.claims.filter((c) => c.verdict === kind).length;
}

/** Collapses whitespace so quotes match regardless of indentation/tabs. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Lines of the answer outside fenced code blocks (fix snippets are not anchors). */
function proseLines(answer: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of answer.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out;
}

const QUOTE_RE = /«([^»]+)»/g;
// "стр. 12", "строка 32", "строке 62", "Lines 26–28, 63–65", "Line 5-7".
const LINE_REF_RE =
  /(?:стр\.?|строк[аиеу]?|lines?)\s*((?:\d+(?:\s*[–—-]\s*\d+)?)(?:\s*,\s*\d+(?:\s*[–—-]\s*\d+)?)*)/giu;
// Code-ish tokens used to VERIFY a line reference against the source window:
// «quotes», `backticks`, dotted calls (http.NewRequest), calls (len(name)),
// indexing (cache[id]), increments (requests++), camelCase identifiers
// (baseURL), string literals ("missing id").
const TOKEN_RES: readonly RegExp[] = [
  /«([^»]+)»/g,
  /`([^`]+)`/g,
  /\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)/g,
  /\b([A-Za-z_]\w*\([^()]*\))/g,
  /\b([A-Za-z_]\w*\[[^\]]*\])/g,
  /\b([A-Za-z_]\w*\+\+)/g,
  /\b([a-z]+[A-Z]\w*)\b/g,
  // String literal: no whitespace right inside the quotes, so the text between
  // an empty `""` and the next literal is not mistaken for one.
  /("[^"\s][^"]{1,60}[^"\s]")/g,
];

function tokensOf(line: string): string[] {
  const tokens = new Set<string>();
  for (const re of TOKEN_RES) {
    for (const m of line.matchAll(re)) {
      const token = normalize(m[1] ?? '');
      if (token.length >= 3) tokens.add(token);
    }
  }
  return [...tokens];
}

function parseRanges(spec: string): [number, number][] {
  return spec.split(',').map((part) => {
    const [a, b] = part.split(/[–—-]/).map((n) => Number(n.trim()));
    return [a!, b ?? a!];
  });
}

/**
 * Anchor validity (R13/R14), deterministic:
 * - a «quote» is valid when it occurs verbatim (whitespace-normalized) in the source;
 * - a line reference is valid when a code token from the same answer line
 *   occurs in the source within the referenced range ±1 line. A reference with
 *   no code token on its line cannot be checked and is counted as unverifiable.
 * Heuristic by design: the LLM judge covers meaning; this covers "does the
 * anchor point at real code".
 */
export function checkAnchors(answer: string, source: string): AnchorStats {
  const srcLines = source.replace(/\r\n?/g, '\n').split('\n');
  const srcNorm = normalize(source);
  let quotes = 0;
  let validQuotes = 0;
  let refs = 0;
  let validRefs = 0;
  let unverifiable = 0;

  for (const line of proseLines(answer)) {
    for (const m of line.matchAll(QUOTE_RE)) {
      const quote = normalize(m[1] ?? '');
      if (quote.length < 3) continue;
      quotes += 1;
      if (srcNorm.includes(quote)) validQuotes += 1;
    }

    const tokens = tokensOf(line);
    for (const m of line.matchAll(LINE_REF_RE)) {
      for (const [from, to] of parseRanges(m[1] ?? '')) {
        refs += 1;
        if (tokens.length === 0) {
          unverifiable += 1;
          continue;
        }
        const lo = Math.max(1, Math.min(from, to) - 1);
        const hi = Math.min(srcLines.length, Math.max(from, to) + 1);
        if (lo > srcLines.length) continue; // points past the end: invalid
        const window = normalize(srcLines.slice(lo - 1, hi).join('\n'));
        if (tokens.some((t) => window.includes(t))) validRefs += 1;
      }
    }
  }

  return {
    quotes: { total: quotes, valid: validQuotes },
    lines: { total: refs, valid: validRefs, unverifiable },
  };
}

/** Share of checkable anchors (quotes + verifiable line refs) that are valid; null if none. */
export function anchorValidity(stats: AnchorStats): number | null {
  const checkable = stats.quotes.total + stats.lines.total - stats.lines.unverifiable;
  if (checkable === 0) return null;
  return (stats.quotes.valid + stats.lines.valid) / checkable;
}

export interface Summary {
  readonly n: number;
  readonly mean: number;
  readonly sd: number;
  readonly min: number;
  readonly max: number;
}

/** Mean ± sample standard deviation — the eval reports spread, not one run. */
export function summarize(values: readonly number[]): Summary | null {
  if (values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (values.length - 1)
      : 0;
  return {
    n: values.length,
    mean,
    sd: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
