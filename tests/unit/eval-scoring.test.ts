import { describe, it, expect } from 'vitest';
import {
  anchorValidity,
  checkAnchors,
  plainRecall,
  summarize,
  weightedRecall,
} from '../../eval/lib/scoring';
import { buildJudgePrompt, parseJudgeVerdict } from '../../eval/lib/judge';
import { buildRequestBody, OpenRouterFetchLlm } from '../../eval/lib/openrouter';
import { loadConfig } from '../../eval/lib/config';
import { renderSummary } from '../../eval/lib/report';
import type { EvalCase, JudgeVerdict } from '../../eval/lib/types';
import goCase from '../../docs/prompt-eval/cases/go-http-cache-review/case.json';
import goSource from '../../docs/prompt-eval/cases/go-http-cache-review/source.go?raw';
import pyCase from '../../docs/prompt-eval/cases/py-job-worker-review/case.json';
import pySource from '../../docs/prompt-eval/cases/py-job-worker-review/source.py?raw';
import shotOnly from '../../docs/prompt-eval/runs/2026-08-27-baseline/answers/go-http-cache-review/app-v1-shot-only.md?raw';
import textAndShot from '../../docs/prompt-eval/runs/2026-08-27-baseline/answers/go-http-cache-review/app-v1-text-and-shot.md?raw';

const GO = goCase as unknown as EvalCase;
const PY = pyCase as unknown as EvalCase;

describe('eval cases (ground truth integrity)', () => {
  it.each([
    [GO, goSource],
    [PY, pySource],
  ])('%s: unique ids and line ranges inside the source', (evalCase, source) => {
    const lineCount = source.replace(/\n$/, '').split('\n').length;
    const ids = evalCase.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of evalCase.findings) {
      expect(f.lines[0]).toBeGreaterThanOrEqual(1);
      expect(f.lines[1]).toBeGreaterThanOrEqual(f.lines[0]);
      expect(f.lines[1]).toBeLessThanOrEqual(lineCount);
    }
  });

  it('go case keeps the 13 baseline items (recall13 stays comparable)', () => {
    expect(GO.findings.filter((f) => f.origin === 'sonnet5-chat')).toHaveLength(13);
  });

  it('the py case is held out', () => {
    expect(PY.heldOut).toBe(true);
  });
});

describe('recall metrics', () => {
  const all = (coverage: JudgeVerdict['coverage'][string]) =>
    Object.fromEntries(GO.findings.map((f) => [f.id, coverage]));

  it('weighted recall is 1 for full coverage and 0 for none', () => {
    expect(weightedRecall(GO.findings, { coverage: all('full') })).toBe(1);
    expect(weightedRecall(GO.findings, { coverage: {} })).toBe(0);
  });

  it('weights a Critical 6× a Low: finding only G1 beats finding only G13', () => {
    const onlyCritical = weightedRecall(GO.findings, { coverage: { G1: 'full' } });
    const onlyLow = weightedRecall(GO.findings, { coverage: { G13: 'full' } });
    expect(onlyCritical / onlyLow).toBeCloseTo(6);
    // Plain recall cannot tell them apart.
    expect(plainRecall(GO.findings, { coverage: { G1: 'full' } })).toBe(
      plainRecall(GO.findings, { coverage: { G13: 'full' } }),
    );
  });

  it('partial counts half', () => {
    expect(plainRecall(GO.findings.slice(0, 2), { coverage: { G1: 'full', G2: 'partial' } })).toBe(0.75);
  });

  it('summarize reports mean and sample sd', () => {
    expect(summarize([0.5, 0.7, 0.9])).toMatchObject({ n: 3, min: 0.5, max: 0.9 });
    expect(summarize([0.5, 0.7, 0.9])!.mean).toBeCloseTo(0.7);
    expect(summarize([0.5, 0.7, 0.9])!.sd).toBeCloseTo(0.2);
    expect(summarize([])).toBeNull();
  });
});

describe('checkAnchors on the real 2026-08-27 baseline answers (R14 evidence)', () => {
  it('screenshot-only run: every line number it cited is correct (read from the gutter)', () => {
    const stats = checkAnchors(shotOnly, goSource);
    expect(stats.lines.total).toBe(6);
    expect(stats.lines.valid).toBe(6);
    expect(stats.quotes.total).toBe(0);
  });

  it('text + screenshot run: the model counted lines itself and got several wrong', () => {
    const stats = checkAnchors(textAndShot, goSource);
    expect(stats.lines.valid).toBeLessThan(stats.lines.total - stats.lines.unverifiable);
    expect(anchorValidity(stats)).toBeLessThan(0.75);
  });

  it('validates «quotes» verbatim (whitespace-insensitive) and ignores fenced code', () => {
    const answer = [
      '- Critical — «cache[id] = name» (стр. 40): гонка.',
      '- High — «requests += 1» (стр. 47): нет такого кода.',
      '```go',
      'x := «not an anchor»',
      '```',
    ].join('\n');
    const stats = checkAnchors(answer, goSource);
    expect(stats.quotes).toEqual({ total: 2, valid: 1 });
    // "стр. 47" + «requests += 1»: the quote is not in the source, but the
    // camelCase-free line has no other token, so it cannot be verified → invalid.
    expect(stats.lines.total).toBe(2);
    expect(stats.lines.valid).toBe(1);
  });

  it('parses comma-separated ranges and counts token-less references as unverifiable', () => {
    const stats = checkAnchors('Lines 26–28, 63–65: ошибки http.NewRequest игнорируются.\nстр. 5: что-то', goSource);
    expect(stats.lines.total).toBe(3);
    expect(stats.lines.valid).toBe(1);
    expect(stats.lines.unverifiable).toBe(1);
    expect(anchorValidity(stats)).toBe(0.5);
  });

  it('does not read words like "pipeline 2" or "inline 3" as line references', () => {
    const stats = checkAnchors('The pipeline 2 stages and inline 3 checks use http.NewRequest.', goSource);
    expect(stats.lines.total).toBe(0);
  });

  it('returns null validity when there is nothing checkable', () => {
    expect(anchorValidity(checkAnchors('Код хороший.', goSource))).toBeNull();
  });
});

describe('judge', () => {
  it('prompt carries the numbered source, every ground-truth id and the review', () => {
    const prompt = buildJudgePrompt(GO, goSource, 'REVIEW-TEXT');
    expect(prompt).toContain('40| \t\tcache[id] = name');
    for (const f of GO.findings) expect(prompt).toContain(`- ${f.id} [${f.severity}]`);
    expect(prompt).toContain('<review>\nREVIEW-TEXT\n</review>');
  });

  it('parses fenced JSON, fills missing ids with miss, drops unknown values', () => {
    const reply = [
      'Here you go:',
      '```json',
      JSON.stringify({
        coverage: { G1: 'full', G2: 'partial', G3: 'bogus', ZZ: 'full' },
        claims: [
          { text: 'lock missing at 56', verdict: 'false_positive', reason: 'it is locked' },
          { text: 'weird', verdict: 'unknown' },
        ],
      }),
      '```',
    ].join('\n');
    const verdict = parseJudgeVerdict(reply, GO);
    expect(verdict.coverage.G1).toBe('full');
    expect(verdict.coverage.G2).toBe('partial');
    expect(verdict.coverage.G3).toBe('miss');
    expect(verdict.coverage.X5).toBe('miss');
    expect(verdict.coverage).not.toHaveProperty('ZZ');
    expect(verdict.claims).toEqual([
      { text: 'lock missing at 56', verdict: 'false_positive', reason: 'it is locked' },
    ]);
  });

  it('throws on a reply without JSON', () => {
    expect(() => parseJudgeVerdict('no json here', GO)).toThrow(/no JSON/);
  });
});

describe('eval OpenRouter transport', () => {
  const messages = [
    { role: 'system' as const, parts: [{ kind: 'text' as const, text: 'sys' }] },
    {
      role: 'user' as const,
      parts: [
        { kind: 'image' as const, imageBase64: 'QUJD' },
        { kind: 'text' as const, text: 'q' },
      ],
    },
  ];

  it('mirrors the native request body: no max_tokens, optional temperature, excluded reasoning', () => {
    const plain = buildRequestBody({ model: 'm', messages });
    expect(plain).toMatchObject({ model: 'm', stream: false, usage: { include: true } });
    expect(plain).not.toHaveProperty('temperature');
    expect(plain).not.toHaveProperty('reasoning');
    expect(plain).not.toHaveProperty('max_tokens');
    expect((plain.messages as unknown[])[0]).toEqual({ role: 'system', content: 'sys' });

    const tuned = buildRequestBody({ model: 'm', messages, temperature: 0.3, reasoningEffort: 'high' });
    expect(tuned).toMatchObject({ temperature: 0.3, reasoning: { effort: 'high', exclude: true } });
  });

  it('maps a completion into text + finish with usage, cost and model', async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          model: 'anthropic/claude-haiku-4.5',
          choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.002 },
        }),
        { status: 200 },
      )) as typeof fetch;
    const chunks = [];
    for await (const c of new OpenRouterFetchLlm('k', fakeFetch).stream({ model: 'm', messages })) chunks.push(c);
    expect(chunks).toEqual([
      { type: 'text-delta', delta: 'answer' },
      {
        type: 'finish',
        reason: 'stop',
        usage: { inputTokens: 10, outputTokens: 3, cost: 0.002 },
        model: 'anthropic/claude-haiku-4.5',
      },
    ]);
  });

  it('classifies HTTP failures for failover like the native client', async () => {
    const status = (code: number) =>
      (async () => new Response(JSON.stringify({ error: { message: 'x' } }), { status: code })) as typeof fetch;
    const first = async (code: number) => {
      for await (const c of new OpenRouterFetchLlm('k', status(code)).stream({ model: 'm', messages })) return c;
    };
    expect(await first(429)).toMatchObject({ type: 'error', retryable: true });
    expect(await first(400)).toMatchObject({ type: 'error', retryable: false });
  });
});

describe('eval config', () => {
  it('defaults to the model × input factorial with 3 repeats', () => {
    const config = loadConfig({});
    expect(config.models).toEqual(['anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-5']);
    expect(config.inputs).toEqual(['text', 'shot']);
    expect(config.prompts).toEqual(['current']);
    expect(config.repeats).toBe(3);
    expect(config.temperature).toBe(0.3);
    expect(config.reasoningEffort).toBeUndefined();
  });

  it('parses lists, off-switches and rejects unknown values', () => {
    const config = loadConfig({
      EVAL_INPUTS: 'text, text+shot',
      EVAL_PROMPTS: 'current,main-2026-07-22',
      EVAL_TEMPERATURE: 'off',
      EVAL_REASONING: 'medium',
      EVAL_REPEATS: '5',
    });
    expect(config.inputs).toEqual(['text', 'text+shot']);
    expect(config.prompts).toEqual(['current', 'main-2026-07-22']);
    expect(config.temperature).toBeUndefined();
    expect(config.reasoningEffort).toBe('medium');
    expect(config.repeats).toBe(5);
    expect(() => loadConfig({ EVAL_INPUTS: 'pixels' })).toThrow(/invalid value/);
    expect(() => loadConfig({ EVAL_REASONING: 'max' })).toThrow(/EVAL_REASONING/);
  });
});

describe('eval report', () => {
  it('aggregates repeats per case × arm with mean ± sd and counts errors', () => {
    const md = renderSummary('T', [
      { caseId: 'c', arm: 'a', repeat: 1, answerFile: 'f', weightedRecall: 0.5, falsePositives: 0, latencyMs: 1000 },
      { caseId: 'c', arm: 'a', repeat: 2, answerFile: 'f', weightedRecall: 0.7, falsePositives: 1, latencyMs: 3000 },
      { caseId: 'c', arm: 'a', repeat: 3, answerFile: 'f', error: 'boom' },
    ]);
    expect(md).toContain('| c | a | 2/3 | 0.60 ± 0.14 |');
    expect(md).toContain('| 2.0 s |');
  });
});
