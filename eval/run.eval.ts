import { describe, it, expect } from 'vitest';
import { loadConfig } from './lib/config';
import { rescoreDir, runGrid } from './lib/harness';

/**
 * Prompt-eval entry point (R13) — `pnpm eval`. Calls real models through
 * OpenRouter, so it only runs with OPENROUTER_API_KEY set (it is skipped
 * otherwise and never part of `pnpm test`). Configuration: env vars, see
 * docs/prompt-eval/README.md.
 */
const apiKey = process.env.OPENROUTER_API_KEY ?? '';

describe.skipIf(!apiKey)('prompt eval', () => {
  it('runs the configured grid (or re-scores EVAL_SCORE_DIR)', async () => {
    const config = loadConfig(process.env);
    const dir = config.scoreDir
      ? await rescoreDir(apiKey, config, config.scoreDir)
      : await runGrid(apiKey, config);
    console.log(`eval results: ${dir}`);
    expect(dir).toBeTruthy();
  });
});
