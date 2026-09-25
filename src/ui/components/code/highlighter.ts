import type { HighlighterCore, ThemedToken } from 'shiki/core';

/**
 * Syntax highlighting for code blocks in answers (task 11), built on
 * `shiki/core` with the JavaScript regex engine:
 * - no WASM — the production CSP (`script-src 'self'`) does not allow
 *   WebAssembly compilation, which the default Oniguruma engine needs;
 * - only the grammars the agents actually produce, each loaded on first use
 *   (a code-split chunk), so startup pays for none of them;
 * - tokens, not HTML: the result is rendered as React spans, so model output
 *   never goes through `dangerouslySetInnerHTML` (architecture.md §11).
 *
 * Every failure (unknown language, a grammar the JS engine cannot compile)
 * degrades to plain text — highlighting is cosmetic, the code must show.
 */

export const HIGHLIGHT_THEME = 'github-dark-default';

/** Fence tag → grammar module. Aliases map to the same loader. */
const GRAMMARS: Record<string, () => Promise<unknown>> = {
  go: () => import('shiki/langs/go.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

const ALIASES: Record<string, string> = {
  golang: 'go',
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  'c#': 'csharp',
  cs: 'csharp',
  kt: 'kotlin',
  rs: 'rust',
  'c++': 'cpp',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  postgresql: 'sql',
  postgres: 'sql',
  mysql: 'sql',
};

/** Canonical grammar id for a fence tag, or null when not supported. */
export function resolveLanguage(tag: string | undefined): string | null {
  if (!tag) return null;
  const lower = tag.toLowerCase();
  const id = ALIASES[lower] ?? lower;
  return id in GRAMMARS ? id : null;
}

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Map<string, Promise<boolean>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, theme] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-dark-default.mjs'),
    ]);
    return createHighlighterCore({
      themes: [theme.default],
      langs: [],
      // `forgiving`: skip the few patterns the JS engine can't express
      // (C#'s overlapping recursions, Swift's `(?(` conditionals) instead of
      // rejecting the whole grammar — slightly less precise, never plain.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  // A failed chunk load is transient: forget it so the next block retries.
  highlighter.catch(() => {
    highlighter = null;
  });
  return highlighter;
}

async function ensureLanguage(core: HighlighterCore, lang: string): Promise<boolean> {
  let ready = loaded.get(lang);
  if (!ready) {
    ready = GRAMMARS[lang]!().then(
      (mod) =>
        core
          .loadLanguage((mod as { default: Parameters<HighlighterCore['loadLanguage']>[0] }).default)
          .then(() => true)
          // The grammar itself does not compile: permanent, stay plain.
          .catch(() => false),
      () => {
        // The chunk failed to load: transient, retry on the next block.
        loaded.delete(lang);
        return false;
      },
    );
    loaded.set(lang, ready);
  }
  return ready;
}

/**
 * Highlighted token lines for `code`, or null when the language is unsupported
 * or highlighting fails (the caller then shows plain text).
 */
export async function highlightTokens(code: string, tag: string | undefined): Promise<ThemedToken[][] | null> {
  const lang = resolveLanguage(tag);
  if (!lang) return null;
  try {
    const core = await getHighlighter();
    if (!(await ensureLanguage(core, lang))) return null;
    return core.codeToTokens(code, { lang, theme: HIGHLIGHT_THEME }).tokens;
  } catch {
    return null;
  }
}
