import { useEffect, useState } from 'react';
import type { ThemedToken } from 'shiki/core';
import { highlightTokens } from './highlighter';

interface CodeBlockProps {
  readonly code: string;
  /** Fence tag from the markdown (e.g. `go`), if any. */
  readonly lang?: string;
}

/** Highlighting is re-run at most this often while an answer streams in. */
const HIGHLIGHT_DEBOUNCE_MS = 150;

/**
 * Presentational: a fenced code block with syntax highlighting and a copy
 * button (task 11). Plain text renders immediately; highlighted tokens replace
 * it once ready (debounced while the code is still streaming in). Copying uses
 * the Clipboard API inside the click — a user gesture — with a hidden-textarea
 * fallback for webviews that deny it.
 */
export function CodeBlock({ code, lang }: CodeBlockProps) {
  const [tokens, setTokens] = useState<{ code: string; lines: ThemedToken[][] } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void highlightTokens(code, lang).then((lines) => {
        if (!cancelled) setTokens(lines ? { code, lines } : null);
      });
    }, HIGHLIGHT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, lang]);

  const copy = async () => {
    const ok = await copyText(code);
    setCopied(ok);
    if (ok) window.setTimeout(() => setCopied(false), 1500);
  };

  // Stale tokens (for an older, shorter version of a streaming block) are
  // shown only while they still match; otherwise the plain text is current.
  const lines = tokens?.code === code ? tokens.lines : null;

  return (
    <div className="group relative my-2">
      <div className="flex items-center justify-between rounded-t-md border border-b-0 border-neutral-700 bg-neutral-800/80 px-2 py-0.5 text-[10px] text-neutral-400">
        <span>{lang ?? 'code'}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label="Скопировать код"
          className="text-neutral-400 hover:text-neutral-100"
        >
          {copied ? '✓ скопировано' : 'копировать'}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto rounded-b-md border border-neutral-700 bg-[#0d1117] p-2 text-xs leading-relaxed">
        <code data-highlighted={lines ? 'true' : 'false'}>
          {lines
            ? lines.map((line, i) => (
                <span key={i} className="block">
                  {line.map((token, j) => (
                    <span key={j} style={{ color: token.color }}>
                      {token.content}
                    </span>
                  ))}
                  {line.length === 0 ? '\n' : null}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback: a hidden textarea + execCommand (deprecated, still supported).
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}
