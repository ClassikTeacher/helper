// Validates the configured model chains against OpenRouter's public model list
// (P1, item 10) — the slugs in `src/core/domain/model-route.ts` are
// placeholders, and a wrong or text-only slug on the screenshot path only shows
// up as a runtime failover (or a hard 400).
//
//   pnpm models:check            # uses .env (if present) + compiled-in defaults
//
// No API key needed: GET /api/v1/models is public. For every model in the
// light/heavy chains it checks: the slug exists, it accepts image input (the
// main scenario always sends a screenshot), and it supports the parameters the
// route sends (temperature / reasoning). Exit code 1 when any check fails.
// Plain Node ESM, no build step; env parsing mirrors src/bootstrap/model-chain.ts.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimal .env reader matching Vite's dotenv for the cases that matter here:
 * `KEY=VALUE`, full-line `#` comments, quoted values ('…' / "…" — quotes
 * stripped, `#` kept), and ` #` inline comments after unquoted values.
 */
export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2].trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim();
    env[m[1]] = value;
  }
  return env;
}

function readEnvFile(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

/** Compiled-in defaults, read from model-route.ts so they can't drift. */
function readDefaults() {
  const src = readFileSync(join(ROOT, 'src/core/domain/model-route.ts'), 'utf8');
  const catalog = Object.fromEntries(
    [...src.matchAll(/^\s+(\w+): '([^']+)',/gm)].map((m) => [m[1], m[2]]),
  );
  const alias = (name) => catalog[name];
  const primary = alias(/DEFAULT_MODEL: ModelSlug = AVAILABLE_MODELS\.(\w+)/.exec(src)?.[1]);
  const fallbacksBlock = /DEFAULT_FALLBACKS[^=]*=\s*\[([^\]]*)\]/.exec(src)?.[1] ?? '';
  const fallbacks = [...fallbacksBlock.matchAll(/AVAILABLE_MODELS\.(\w+)/g)].map((m) => alias(m[1]));
  return { primary, fallbacks };
}

const list = (v) => v?.split(',').map((s) => s.trim()).filter(Boolean);
const dedupe = (xs) => [...new Set(xs.filter(Boolean))];

function routes(env) {
  const defaults = readDefaults();
  const basePrimary = env.VITE_DEFAULT_MODEL?.trim() || defaults.primary;
  const base = dedupe([basePrimary, ...(list(env.VITE_MODEL_FALLBACKS) ?? defaults.fallbacks)]);
  const route = (prefix) => {
    const temperature = env[`VITE_${prefix}_TEMPERATURE`]?.trim().toLowerCase();
    const reasoning = env[`VITE_${prefix}_REASONING`]?.trim().toLowerCase();
    const wantsReasoning = ['low', 'medium', 'high'].includes(reasoning);
    return {
      chain: dedupe([env[`VITE_${prefix}_MODEL`]?.trim() || base[0], ...(list(env[`VITE_${prefix}_MODEL_FALLBACKS`]) ?? base)]),
      reasoning: wantsReasoning,
      // Same rule as the app: reasoning drops the temperature.
      temperature: !wantsReasoning && temperature !== 'off' && temperature !== 'none',
    };
  };
  return { light: route('LIGHT'), heavy: route('HEAVY') };
}

// Run as a script (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();

async function main() {
const env = { ...readEnvFile(join(ROOT, '.env')), ...process.env };
const res = await fetch('https://openrouter.ai/api/v1/models');
if (!res.ok) {
  console.error(`OpenRouter models API: HTTP ${res.status}`);
  process.exit(2);
}
const models = new Map((await res.json()).data.map((m) => [m.id, m]));

let failed = false;
for (const [name, route] of Object.entries(routes(env))) {
  console.log(`\n${name} route${route.reasoning ? ' (reasoning)' : ''}:`);
  for (const [i, slug] of route.chain.entries()) {
    const m = models.get(slug);
    const problems = [];
    if (!m) problems.push('NOT FOUND on OpenRouter');
    else {
      const input = m.architecture?.input_modalities ?? [];
      const params = m.supported_parameters ?? [];
      if (!input.includes('image')) problems.push('no image input (screenshots will be rejected)');
      if (route.temperature && !params.includes('temperature')) problems.push('does not list "temperature"');
      if (route.reasoning && !params.includes('reasoning')) problems.push('does not list "reasoning" (ignored or rejected)');
    }
    failed ||= problems.length > 0;
    const price = m ? ` · $${(Number(m.pricing.prompt) * 1e6).toFixed(2)}/$${(Number(m.pricing.completion) * 1e6).toFixed(2)} per 1M in/out` : '';
    console.log(`  ${i === 0 ? 'primary ' : 'fallback'} ${slug}${price}`);
    for (const p of problems) console.log(`           ✗ ${p}`);
  }
}
console.log(failed ? '\nSome checks failed.' : '\nAll models OK.');
process.exit(failed ? 1 : 0);
}
