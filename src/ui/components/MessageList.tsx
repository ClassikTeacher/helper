import { MarkdownMessage } from './MarkdownMessage';

interface MessageListProps {
  readonly answer: string;
  readonly streaming: boolean;
  readonly error: string | null;
}

/**
 * Presentational: shows the current answer (streaming) or an error.
 */
export function MessageList({ answer, streaming, error }: MessageListProps) {
  if (error) {
    return <div className="text-red-400 text-sm">Error: {error}</div>;
  }
  if (!answer && !streaming) {
    return <div className="text-neutral-500 text-sm">Press the hotkey or ask something…</div>;
  }
  return (
    <div className="space-y-2">
      <MarkdownMessage content={answer} />
      {streaming && <span className="inline-block h-4 w-2 animate-pulse bg-neutral-400 align-middle" />}
    </div>
  );
}
