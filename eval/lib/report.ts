import { summarize, type Summary } from './scoring';

/** One scored answer — the unit the report aggregates. */
export interface ScoredRun {
  readonly caseId: string;
  /** Grid arm, e.g. `current · anthropic/claude-haiku-4.5 · shot`. */
  readonly arm: string;
  readonly repeat: number;
  readonly answerFile: string;
  readonly error?: string;
  readonly weightedRecall?: number;
  /** Recall over the original 13 baseline items (origin sonnet5-chat), if the case has them. */
  readonly recall13?: number;
  readonly falsePositives?: number;
  readonly validExtras?: number;
  readonly anchorValidity?: number | null;
  readonly latencyMs?: number;
  readonly cost?: number;
  readonly finishReason?: string;
  readonly servedModel?: string;
}

function fmt(s: Summary | null, digits = 2): string {
  if (!s) return '—';
  return s.n > 1 ? `${s.mean.toFixed(digits)} ± ${s.sd.toFixed(digits)}` : s.mean.toFixed(digits);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const num = (v: number | null | undefined): v is number => typeof v === 'number';

/** Markdown summary: one row per case × arm, mean ± sd across repeats. */
export function renderSummary(title: string, runs: readonly ScoredRun[], notes: readonly string[] = []): string {
  const groups = new Map<string, ScoredRun[]>();
  for (const run of runs) {
    const key = `${run.caseId}\u0000${run.arm}`;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  const rows = [...groups.entries()].map(([key, group]) => {
    const [caseId, arm] = key.split('\u0000');
    const ok = group.filter((r) => !r.error);
    const latency = median(ok.map((r) => r.latencyMs).filter(num));
    const costs = ok.map((r) => r.cost).filter(num);
    const cut = ok.filter((r) => r.finishReason === 'length').length;
    return [
      caseId,
      arm,
      `${ok.length}/${group.length}`,
      fmt(summarize(ok.map((r) => r.weightedRecall).filter(num))),
      fmt(summarize(ok.map((r) => r.recall13).filter(num))),
      fmt(summarize(ok.map((r) => r.falsePositives).filter(num)), 1),
      fmt(summarize(ok.map((r) => r.validExtras).filter(num)), 1),
      fmt(summarize(ok.map((r) => r.anchorValidity).filter(num))),
      latency === null ? '—' : `${(latency / 1000).toFixed(1)} s`,
      costs.length ? `$${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)}` : '—',
      String(cut),
    ].join(' | ');
  });

  return [
    `# ${title}`,
    '',
    ...notes.map((n) => `> ${n}`),
    ...(notes.length ? [''] : []),
    '| case | arm | ok/n | weighted recall | recall13 | FP | valid extras | anchors | latency (median) | cost (mean) | length-cut |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r} |`),
    '',
    'Metrics: docs/prompt-eval/README.md. Values are mean ± sd over repeats.',
    '',
  ].join('\n');
}
