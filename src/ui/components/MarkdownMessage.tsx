import { isValidElement, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code/CodeBlock';

interface MarkdownMessageProps {
  readonly content: string;
}

/**
 * Fenced blocks (`pre > code.language-x`) render as a highlighted CodeBlock
 * with a copy button; inline code keeps the default rendering. Raw HTML stays
 * disabled (no rehype-raw) — model output is untrusted (architecture.md §11).
 *
 * Links never navigate (2026-10 review §2.5): the HUD is a frameless overlay
 * webview, and a click on a real `<a href>` would replace it with the external
 * page — there is no address bar or back button, and the link may have been
 * planted through the screenshot or the transcript (prompt injection → phishing
 * inside a trusted-looking window). The link text and its URL are rendered as
 * plain, selectable text instead; the user can copy a URL they actually want.
 */
const COMPONENTS: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const lang = /language-([\w#+-]+)/.exec(child.props.className ?? '')?.[1];
      const code = textOf(child.props.children).replace(/\n$/, '');
      return <CodeBlock code={code} {...(lang ? { lang } : {})} />;
    }
    return <pre>{children}</pre>;
  },
  a({ href, children }) {
    const url = href ?? '';
    const label = textOf(children);
    // GFM autolinks have label === url: show it once.
    const showUrl = url && label !== url;
    return (
      <span className="text-indigo-300 underline decoration-dotted" data-link-url={url || undefined}>
        {label}
        {showUrl ? <span className="text-neutral-500"> ({url})</span> : null}
      </span>
    );
  },
};

/** Plain text of a React children tree (react-markdown gives code as strings). */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** Presentational: renders streaming markdown. Pure — props in, no logic. */
export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {content}
      </Markdown>
    </div>
  );
}
