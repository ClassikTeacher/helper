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
