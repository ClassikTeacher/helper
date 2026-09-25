import { numberLines } from '@/core/application/services/agent-prompt';
import type { ClaimVerdict, Coverage, EvalCase, JudgeVerdict } from './types';

/**
 * LLM-as-judge for review answers (R13): maps an answer's findings onto the
 * case's ground truth and classifies everything else. The judge sees the
 * numbered source, so it can tell a real extra defect from a false claim.
 */

const COVERAGES: readonly Coverage[] = ['full', 'partial', 'miss'];
const CLAIM_VERDICTS: readonly ClaimVerdict[] = ['valid_extra', 'false_positive', 'neutral'];

export const JUDGE_SYSTEM_PROMPT = [
  'You are a strict, impartial evaluator of a coding assistant\'s answers (code reviews and task',
  'solutions). You compare one answer against a ground-truth list. Reply with JSON only — no prose.',
].join('\n');

export function buildJudgePrompt(evalCase: EvalCase, source: string, answer: string): string {
  const truth = evalCase.findings
    .map((f) => `- ${f.id} [${f.severity}] lines ${f.lines[0]}-${f.lines[1]}: ${f.title}. ${f.detail}`)
    .join('\n');
  if (evalCase.kind === 'solve') return buildSolveJudgePrompt(source, truth, answer);
  return [
    'Source code (line numbers added):',
    '<source>',
    numberLines(source),
    '</source>',
    '',
    'Ground-truth defects:',
    '<ground_truth>',
    truth,
    '</ground_truth>',
    '',
    'The review to evaluate (it may be in Russian):',
    '<review>',
    answer,
    '</review>',
    '',
    'Tasks:',
    '1. For EVERY ground-truth id, decide coverage:',
    '   - "full": the review identifies this defect — the same problem at the same place, with its',
    '     essence (what goes wrong). Wording, severity label and fix quality do not matter.',
    '   - "partial": the review touches it (right place or symptom) but misses the essence, or covers',
    '     only a part of a compound item.',
    '   - "miss": not mentioned.',
    '   One review statement may cover several ids; an id is covered once.',
    '2. List every OTHER issue the review raises that maps to no ground-truth id, as a claim:',
    '   - "valid_extra": a real defect in this code;',
    '   - "false_positive": factually wrong about this code (e.g. claims a lock is missing where it exists);',
    '   - "neutral": style/opinion that is neither a defect nor wrong.',
    '   Also list as "false_positive" a statement that is attached to a ground-truth id but is',
    '   factually wrong about the code.',
    '',
    'Answer with exactly this JSON shape:',
    '{"coverage": {"<id>": "full|partial|miss", ...}, "claims": [{"text": "<short paraphrase>", "verdict": "valid_extra|false_positive|neutral", "reason": "<one sentence>"}]}',
  ].join('\n');
}

/** Solve cases: the ground truth is a list of criteria a correct answer meets. */
function buildSolveJudgePrompt(source: string, truth: string, answer: string): string {
  return [
    'The task shown to the assistant (line numbers added):',
    '<task>',
    numberLines(source),
    '</task>',
    '',
    'Criteria a correct answer must satisfy:',
    '<criteria>',
    truth,
    '</criteria>',
    '',
    "The assistant's answer to evaluate (it may be in Russian):",
    '<answer>',
    answer,
    '</answer>',
    '',
    'Tasks:',
    '1. For EVERY criterion id, decide coverage: "full" (satisfied), "partial" (partly, or with a',
    '   flaw), "miss" (not satisfied). Check code for correctness yourself — do not trust claims.',
    '2. List as claims every factual error in the answer or bug in its code ("false_positive"),',
    '   and any notable correct point beyond the criteria ("valid_extra"); style remarks → "neutral".',
    '',
    'Answer with exactly this JSON shape:',
    '{"coverage": {"<id>": "full|partial|miss", ...}, "claims": [{"text": "<short paraphrase>", "verdict": "valid_extra|false_positive|neutral", "reason": "<one sentence>"}]}',
  ].join('\n');
}

/**
 * Parses the judge's reply: tolerates code fences and prose around the JSON,
 * drops unknown ids/values, and treats missing ids as `miss`.
 */
export function parseJudgeVerdict(text: string, evalCase: EvalCase): JudgeVerdict {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('judge reply has no JSON object');
  const raw = JSON.parse(text.slice(start, end + 1)) as {
    coverage?: Record<string, unknown>;
    claims?: unknown[];
  };

  const coverage: Record<string, Coverage> = {};
  for (const f of evalCase.findings) {
    const value = raw.coverage?.[f.id];
    coverage[f.id] = COVERAGES.includes(value as Coverage) ? (value as Coverage) : 'miss';
  }

  const claims = (Array.isArray(raw.claims) ? raw.claims : [])
    .filter((c): c is { text?: unknown; verdict?: unknown; reason?: unknown } => typeof c === 'object' && c !== null)
    .filter((c) => CLAIM_VERDICTS.includes(c.verdict as ClaimVerdict))
    .map((c) => ({
      text: String(c.text ?? ''),
      verdict: c.verdict as ClaimVerdict,
      ...(typeof c.reason === 'string' ? { reason: c.reason } : {}),
    }));

  return { coverage, claims };
}
