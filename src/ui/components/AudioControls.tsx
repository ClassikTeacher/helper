interface AudioControlsProps {
  readonly recording: boolean;
  readonly transcribing: boolean;
  readonly transcript: string;
  readonly onToggle: () => void;
  readonly disabled?: boolean;
  /** Seconds since the recording started (0 when not recording). */
  readonly elapsedSecs?: number;
  /** Rolling window: only the last this-many seconds are sent. */
  readonly windowSecs?: number;
}

function clock(secs: number): string {
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

/**
 * Presentational: loopback audio recording controls (phase 9). A record toggle
 * button, a "● запись" indicator while capturing, a "расшифровка…" spinner while
 * transcribing, and a read-only transcript preview once available. No logic, no
 * I/O — the toggle is delegated to `useToggleRecording`; transcript editing /
 * persistence is deferred (user decision).
 */
export function AudioControls({
  recording,
  transcribing,
  transcript,
  onToggle,
  disabled = false,
  elapsedSecs = 0,
  windowSecs = 60,
}: AudioControlsProps) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          aria-pressed={recording}
          aria-label={recording ? 'Остановить запись' : 'Записать звук собеседника'}
          className={`rounded-md border px-2 py-1 text-xs ${
            recording
              ? 'border-red-600/60 bg-red-950/50 text-red-300 hover:bg-red-900/50'
              : 'border-neutral-700 bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
          } disabled:opacity-50`}
        >
          {recording ? '■ Стоп' : '● Запись'}
        </button>
        {recording && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
            запись {clock(elapsedSecs)}
            {/* The window rolls: past it, the OLDEST audio is dropped (P0). */}
            {elapsedSecs > windowSecs && (
              <span className="text-amber-400">· в запрос уйдут последние {windowSecs} с</span>
            )}
          </span>
        )}
        {transcribing && <span className="text-xs text-indigo-300">расшифровка…</span>}
      </div>
      {transcript && (
        <div className="mt-2 rounded-md border border-neutral-700/70 bg-neutral-800/40 px-3 py-2 text-xs text-neutral-300">
          <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
            Транскрипт
          </span>
          <p className="whitespace-pre-wrap break-words">{transcript}</p>
        </div>
      )}
    </div>
  );
}
