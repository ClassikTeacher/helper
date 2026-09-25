import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AgentRunner } from '@/core/application/services/agent-runner';
import { ResilientLlm } from '@/core/application/services/resilient-llm';
import { ScreenTranscriber } from '@/core/application/services/screen-transcriber';
import { languageLabel, type ProgrammingLanguage } from '@/core/domain/language';
import { AGENTS } from '@/core/domain/agents-catalog';
import { MAX_IMAGE_EDGE_LIMIT, type RouteProfile } from '@/core/domain/model-route';
import type { LlmFinish, LlmMessage, LlmPort } from '@/core/application/ports/llm.port';
import type { Screenshot } from '@/core/domain/screenshot';
import type { ScreenCapturePort } from '@/core/application/ports/screen-capture.port';
import { armApplies, type EvalConfig, type InputMode, type PromptVariant } from './config';
import { JUDGE_SYSTEM_PROMPT, buildJudgePrompt, parseJudgeVerdict } from './judge';
import { OpenRouterFetchLlm } from './openrouter';
import { buildMainSnapshotPrompt } from './prompts-main-2026-07-22';
import { renderSummary, type ScoredRun } from './report';
import { anchorValidity, checkAnchors, countClaims, plainRecall, weightedRecall } from './scoring';
import type { EvalCase } from './types';

/**
 * Eval harness I/O (R13): loads cases, runs the grid through the production
 * AgentRunner + ResilientLlm, judges, scores, and writes a run directory.
 */

export const EVAL_ROOT = join(process.cwd(), 'docs', 'prompt-eval');

export interface LoadedCase {
  readonly meta: EvalCase;
  readonly source: string;
  readonly dir: string;
}

export async function loadCases(selection: EvalConfig['cases']): Promise<LoadedCase[]> {
  const casesDir = join(EVAL_ROOT, 'cases');
  const ids =
    selection === 'all'
      ? (await readdir(casesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)
      : [...selection];
  return Promise.all(
    ids.map(async (id) => {
      const dir = join(casesDir, id);
      const meta = JSON.parse(await readFile(join(dir, 'case.json'), 'utf8')) as EvalCase;
      return { meta, dir, source: await readFile(join(dir, meta.source), 'utf8') };
    }),
  );
}

/** Reads the rendered frames of a variant (see eval/render-shots.mjs). */
export async function loadShots(loaded: LoadedCase, variant: string): Promise<Screenshot[]> {
  const manifestPath = join(loaded.dir, 'shots', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}')) as Record<string, string[]>;
  const files = manifest[variant];
  if (!files) {
    throw new Error(`${loaded.meta.id}: no shot variant "${variant}" — run \`pnpm eval:shots\` first`);
  }
  return Promise.all(
    files.map(async (file) => {
      const png = await readFile(join(loaded.dir, 'shots', file));
      // PNG IHDR: width/height are big-endian u32 at byte offsets 16 and 20.
      return {
        imageBase64: png.toString('base64'),
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20),
        capturedAt: 0,
      };
    }),
  );
}

const NO_CAPTURE: ScreenCapturePort = {
  capture: async () => {
    throw new Error('eval: unexpected live capture — every arm supplies its inputs');
  },
};

export interface Arm {
  readonly prompt: PromptVariant;
  readonly model: string;
  readonly input: InputMode;
}

export function armLabel(arm: Arm): string {
  return `${arm.prompt} · ${arm.model} · ${arm.input}`;
}

export interface Answer {
  readonly text: string;
  readonly finish?: LlmFinish;
  readonly latencyMs: number;
}

/** Runs one arm once. The current prompt goes through AgentRunner exactly like the app. */
export async function runArm(
  apiKey: string,
  config: EvalConfig,
  loaded: LoadedCase,
  shots: readonly Screenshot[],
  arm: Arm,
): Promise<Answer> {
  const profile: RouteProfile = {
    chain: [arm.model],
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
    // The shot variant already fixes the pixel size; never shrink further here.
    maxImageEdge: MAX_IMAGE_EDGE_LIMIT,
  };
  const llm: LlmPort = new ResilientLlm(new OpenRouterFetchLlm(apiKey), { light: profile, heavy: profile });
  const withShots = arm.input !== 'text';
  const withText = arm.input === 'text' || arm.input === 'text+shot';
  const language = loaded.meta.language as ProgrammingLanguage;
  const started = Date.now();
  let text = '';
  let finish: LlmFinish | undefined;

  if (arm.prompt === 'current') {
    // `shot+ocr`: the production transcription pass (P1 item 7), on the arm's
    // model unless EVAL_TRANSCRIBE_MODEL names a dedicated one.
    const transcriber =
      arm.input === 'shot+ocr'
        ? new ScreenTranscriber(llm, {
            agents: new Set([loaded.meta.agent]),
            model: config.transcribeModel ?? arm.model,
          })
        : undefined;
    const runner = new AgentRunner({ screenCapture: NO_CAPTURE, llm, ...(transcriber ? { transcriber } : {}) });
    for await (const delta of runner.analyzeScreen({
      agent: AGENTS[loaded.meta.agent],
      language,
      instructions: '',
      screenshots: withShots ? shots : [],
      ...(withText ? { codeText: loaded.source } : {}),
      onFinish: (f) => {
        finish = f;
      },
    })) {
      text += delta;
    }
  } else {
    // The 2026-07-22 app had no code-as-text channel: pasted code went into
    // the hints field — exactly how the baseline "screenshot + text" run was made.
    const { system, userText } = buildMainSnapshotPrompt({
      agentId: loaded.meta.agent,
      ...(language !== 'all' ? { languageLabel: languageLabel(language) } : {}),
      instructions: withText ? loaded.source : '',
    });
    const messages: LlmMessage[] = [
      { role: 'system', parts: [{ kind: 'text', text: system }] },
      {
        role: 'user',
        parts: [
          ...(withShots ? shots : []).map((s) => ({ kind: 'image' as const, imageBase64: s.imageBase64 })),
          { kind: 'text', text: userText },
        ],
      },
    ];
    for await (const chunk of llm.stream({ route: AGENTS[loaded.meta.agent].modelRoute, messages })) {
      if (chunk.type === 'text-delta') text += chunk.delta;
      else if (chunk.type === 'error') throw new Error(chunk.message);
      else finish = chunk;
    }
  }

  return { text, ...(finish ? { finish } : {}), latencyMs: Date.now() - started };
}

/** Judges + scores one answer (judge temperature 0 by default), retried once on bad JSON. */
export async function scoreAnswer(
  apiKey: string,
  judge: Pick<EvalConfig, 'judgeModel' | 'judgeTemperature'>,
  loaded: LoadedCase,
  answer: string,
): Promise<Pick<ScoredRun, 'weightedRecall' | 'recall13' | 'falsePositives' | 'validExtras' | 'anchorValidity'> & {
  verdict: unknown;
}> {
  const llm = new OpenRouterFetchLlm(apiKey);
  const messages: LlmMessage[] = [
    { role: 'system', parts: [{ kind: 'text', text: JUDGE_SYSTEM_PROMPT }] },
    { role: 'user', parts: [{ kind: 'text', text: buildJudgePrompt(loaded.meta, loaded.source, answer) }] },
  ];
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply = '';
    for await (const chunk of llm.stream({
      model: judge.judgeModel,
      ...(judge.judgeTemperature !== undefined ? { temperature: judge.judgeTemperature } : {}),
      messages,
    })) {
      if (chunk.type === 'text-delta') reply += chunk.delta;
      else if (chunk.type === 'error') throw new Error(`judge: ${chunk.message}`);
    }
    try {
      const verdict = parseJudgeVerdict(reply, loaded.meta);
      const baseline13 = loaded.meta.findings.filter((f) => f.origin === 'sonnet5-chat');
      return {
        verdict,
        weightedRecall: weightedRecall(loaded.meta.findings, verdict),
        ...(baseline13.length > 0 ? { recall13: plainRecall(baseline13, verdict) } : {}),
        falsePositives: countClaims(verdict, 'false_positive'),
        validExtras: countClaims(verdict, 'valid_extra'),
        anchorValidity: anchorValidity(checkAnchors(answer, loaded.source)),
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`judge reply unparseable: ${String(lastError)}`);
}

/** Runs tasks with at most `limit` in flight. */
export async function pool<T>(limit: number, tasks: readonly (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function slug(text: string): string {
  return text.replace(/[^A-Za-z0-9.+-]+/g, '_');
}

/** Full grid: every case × prompt × model × input × repeat. Writes the run dir. */
export async function runGrid(apiKey: string, config: EvalConfig): Promise<string> {
  const cases = await loadCases(config.cases);
  const date = new Date().toISOString().slice(0, 10);
  const runDir = join(EVAL_ROOT, 'runs', `${date}-${slug(config.label)}`);

  const tasks: (() => Promise<ScoredRun>)[] = [];
  for (const loaded of cases) {
    const needsShots = config.inputs.some((i) => i !== 'text' && armApplies(loaded.meta, 'current', i));
    const shots = needsShots ? await loadShots(loaded, config.shotVariant) : [];
    for (const prompt of config.prompts)
      for (const model of config.models)
        for (const input of config.inputs.filter((i) => armApplies(loaded.meta, prompt, i)))
          for (let repeat = 1; repeat <= config.repeats; repeat++) {
            const arm: Arm = { prompt, model, input };
            tasks.push(async () => {
              const answerFile = join(
                'answers',
                loaded.meta.id,
                `${slug(prompt)}__${slug(model)}__${slug(input)}__${repeat}.md`,
              );
              const base = { caseId: loaded.meta.id, arm: armLabel(arm), repeat, answerFile };
              try {
                const answer = await runArm(apiKey, config, loaded, shots, arm);
                await mkdir(join(runDir, 'answers', loaded.meta.id), { recursive: true });
                await writeFile(join(runDir, answerFile), answer.text);
                const scored = await scoreAnswer(apiKey, config, loaded, answer.text);
                await writeFile(
                  join(runDir, `${answerFile}.verdict.json`),
                  `${JSON.stringify(scored.verdict, null, 2)}\n`,
                );
                const { verdict: _verdict, ...metrics } = scored;
                return {
                  ...base,
                  ...metrics,
                  latencyMs: answer.latencyMs,
                  ...(answer.finish?.usage?.cost !== undefined ? { cost: answer.finish.usage.cost } : {}),
                  ...(answer.finish ? { finishReason: answer.finish.reason } : {}),
                  ...(answer.finish?.model ? { servedModel: answer.finish.model } : {}),
                };
              } catch (e) {
                return { ...base, error: e instanceof Error ? e.message : String(e) };
              }
            });
          }
  }

  const runs = await pool(config.concurrency, tasks);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'results.json'), `${JSON.stringify({ config, runs }, null, 2)}\n`);
  await writeFile(
    join(runDir, 'summary.md'),
    renderSummary(`Eval run ${basename(runDir)}`, runs, [
      `shots: ${config.shotVariant} · repeats: ${config.repeats} · temperature: ${config.temperature ?? 'off'} · reasoning: ${config.reasoningEffort ?? 'off'} · judge: ${config.judgeModel}`,
    ]),
  );
  return runDir;
}

/** Re-scores saved answers (`<dir>/answers/<case>/*.md`) with the judge + anchors. */
export async function rescoreDir(apiKey: string, config: EvalConfig, dir: string): Promise<string> {
  const runDir = join(process.cwd(), dir);
  const cases = await loadCases('all');
  const runs: ScoredRun[] = [];
  for (const loaded of cases) {
    const answersDir = join(runDir, 'answers', loaded.meta.id);
    const files = (await readdir(answersDir).catch(() => [] as string[])).filter((f) => f.endsWith('.md'));
    for (const file of files) {
      const answer = await readFile(join(answersDir, file), 'utf8');
      const base = { caseId: loaded.meta.id, arm: file.replace(/\.md$/, ''), repeat: 1, answerFile: file };
      try {
        const { verdict, ...metrics } = await scoreAnswer(apiKey, config, loaded, answer);
        await writeFile(join(answersDir, `${file}.verdict.json`), `${JSON.stringify(verdict, null, 2)}\n`);
        runs.push({ ...base, ...metrics });
      } catch (e) {
        runs.push({ ...base, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  await writeFile(join(runDir, 'rescored.json'), `${JSON.stringify(runs, null, 2)}\n`);
  await writeFile(
    join(runDir, 'rescored.md'),
    renderSummary(`Re-scored ${dir}`, runs, [`judge: ${config.judgeModel}`]),
  );
  return runDir;
}
