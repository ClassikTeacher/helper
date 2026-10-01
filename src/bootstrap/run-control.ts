/**
 * The single active analysis run (P0). Every send goes through `beginRun`,
 * which aborts the run already in flight — so a second send (hotkey pressed
 * twice, Run while streaming, stop-recording = send) SUPERSEDES the first
 * instead of streaming a second answer into the same HUD buffer. `stopRun` is
 * the user's Stop (button / Esc).
 *
 * The abort reason tells the aborted run how to wind down: a `stop` leaves its
 * partial answer on screen with a "stopped" note; a `superseded` run touches
 * no HUD state at all (the new run owns it). Module state, like the Zustand
 * store — there is exactly one HUD per window.
 */
export type RunAbortReason = 'stop' | 'superseded';

let current: AbortController | null = null;

/** Starts a new run, superseding any run in flight. */
export function beginRun(): AbortSignal {
  current?.abort('superseded' satisfies RunAbortReason);
  current = new AbortController();
  return current.signal;
}

/** Marks a run finished (no-op if a newer run already replaced it). */
export function endRun(signal: AbortSignal): void {
  if (current?.signal === signal) current = null;
}

/** User Stop: aborts the active run, if any. Returns whether one was running. */
export function stopRun(): boolean {
  if (!current) return false;
  current.abort('stop' satisfies RunAbortReason);
  current = null;
  return true;
}

/** Why a run was aborted, or null if it was not. */
export function abortReason(signal: AbortSignal): RunAbortReason | null {
  if (!signal.aborted) return null;
  return signal.reason === 'stop' ? 'stop' : 'superseded';
}
