import { MarkdownMessage } from './MarkdownMessage';

interface MessageListProps {
  readonly answer: string;
  readonly streaming: boolean;
  readonly error: string | null;
  /** The user stopped the answer (the partial answer stays visible). */
  readonly stopped?: boolean;
}

/**
 * Presentational: shows the current answer (streaming) and/or an error.
 *
 * Deliberately additive, not either/or: the terminal `error` chunk (see
 * `LlmPort`/architecture.md §11) can arrive after some `text-delta` chunks
 * already streamed in, and that partial answer is real output worth keeping
 * on screen — discarding it in favor of a bare "Error: ..." message would
 * throw away exactly the "show partial failure" capability the discriminated
 * `LlmChunk` union exists for.
 */
export function MessageList({ answer, streaming, error, stopped = false }: MessageListProps) {
  const hasAnswer = answer.length > 0;

  if (!hasAnswer && !streaming && !error && !stopped) {
    return <div className="text-neutral-500 text-sm">Press the hotkey or ask something…</div>;
  }

  return (
    <div className="space-y-2">
      {hasAnswer && <MarkdownMessage content={answer} />}
      {streaming && <span className="inline-block h-4 w-2 animate-pulse bg-neutral-400 align-middle" />}
      {stopped && !streaming && <div className="text-xs text-neutral-500">Остановлено.</div>}
      {error && (
        <div className="text-red-400 text-sm">{hasAnswer ? `Interrupted: ${error}` : `Error: ${error}`}</div>
      )}
    </div>
  );
}
