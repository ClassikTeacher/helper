import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownMessageProps {
  readonly content: string;
}

/**
 * Presentational: renders streaming markdown. Pure — props in, no logic.
 * TODO(phase 2): swap the code block renderer for Shiki syntax highlighting.
 */
export function MarkdownMessage({ content }: MarkdownMessageProps) {
  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
