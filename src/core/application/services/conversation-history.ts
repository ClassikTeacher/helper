import type { LlmContentPart, LlmMessage } from '@/core/application/ports/llm.port';

/** One completed exchange of a dialog, replayed as context for the next message. */
export interface ConversationTurn {
  /** The user text actually sent (data blocks included) — replayed verbatim. */
  readonly userText: string;
  /**
   * Screenshots (base64) replayed with this turn — ONLY when the task existed
   * solely as pixels (no code text, no transcription); otherwise the text
   * already carries it and the images would just cost tokens again.
   */
  readonly images?: readonly string[];
  /**
   * How many of this turn's screenshots were dropped from the history by the
   * image budget (see `compactHistory`). The model is told they existed.
   */
  readonly omittedImages?: number;
  readonly answer: string;
}

/** What `onPrompt` reports: the user message as sent, before the answer. */
export type SentPrompt = Pick<ConversationTurn, 'userText' | 'images'>;

/**
 * Bounds on the history replayed with each message. Each limit has a high
 * mark that triggers trimming and a lower mark it trims down to: trimming
 * rewrites the start of the request, which invalidates the provider's prompt
 * cache, so it should happen rarely — not on every message once the dialog is
 * long.
 */
export interface HistoryLimits {
  readonly maxTurns: number;
  readonly trimToTurns: number;
  readonly maxChars: number;
  readonly trimToChars: number;
  readonly maxImages: number;
}

export const HISTORY_LIMITS: HistoryLimits = {
  /** Turns kept in the dialog; past this, the oldest are dropped… */
  maxTurns: 12,
  /** …down to this many. */
  trimToTurns: 8,
  /** Characters of replayed text (user texts + answers); past this… */
  maxChars: 60_000,
  /** …the oldest turns are dropped down to this. */
  trimToChars: 40_000,
  /** Screenshots replayed across the whole history (newest turns keep theirs). */
  maxImages: 5,
};

/**
 * Keeps a dialog's history bounded. Pure — the store applies it after every
 * completed message.
 *
 * - Oldest turns are dropped once the dialog exceeds `maxTurns`/`maxChars`,
 *   down to `trimToTurns`/`trimToChars`. The newest turn always stays. There is
 *   no special "first turn": questions in one dialog are often unrelated, so
 *   the oldest one is just the least relevant.
 * - Screenshots are replayed newest-first up to `maxImages`; an older turn
 *   beyond the budget loses all its images (they are replaced by a note, so
 *   the model knows they existed — its answer usually restates the task).
 */
export function compactHistory(
  turns: readonly ConversationTurn[],
  limits: HistoryLimits = HISTORY_LIMITS,
): ConversationTurn[] {
  let kept = [...turns];
  if (kept.length > limits.maxTurns || textSize(kept) > limits.maxChars) {
    while (kept.length > 1 && (kept.length > limits.trimToTurns || textSize(kept) > limits.trimToChars)) {
      kept = kept.slice(1);
    }
  }

  let imageBudget = limits.maxImages;
  const compacted: ConversationTurn[] = [];
  for (let i = kept.length - 1; i >= 0; i--) {
    const turn = kept[i]!;
    const count = turn.images?.length ?? 0;
    if (count === 0) {
      compacted.unshift(turn);
    } else if (count <= imageBudget) {
      imageBudget -= count;
      compacted.unshift(turn);
    } else {
      // Over budget: drop this turn's images (all of them — a partial batch
      // would be a confusing view of one task) and every older turn's too.
      imageBudget = 0;
      compacted.unshift({
        userText: turn.userText,
        answer: turn.answer,
        omittedImages: (turn.omittedImages ?? 0) + count,
      });
    }
  }
  return compacted;
}

function textSize(turns: readonly ConversationTurn[]): number {
  return turns.reduce((sum, t) => sum + t.userText.length + t.answer.length, 0);
}

/**
 * The history as user/assistant message pairs, oldest first. Deterministic:
 * the same turns always produce byte-identical messages, so the request prefix
 * stays stable between messages and the provider's prompt cache can hit.
 */
export function historyMessages(turns: readonly ConversationTurn[]): LlmMessage[] {
  return turns.flatMap((turn): LlmMessage[] => [
    {
      role: 'user',
      parts: [
        ...(turn.images ?? []).map((imageBase64): LlmContentPart => ({ kind: 'image', imageBase64 })),
        ...(turn.omittedImages
          ? [{ kind: 'text' as const, text: omittedImagesNote(turn.omittedImages) }]
          : []),
        { kind: 'text', text: turn.userText },
      ],
    },
    { role: 'assistant', parts: [{ kind: 'text', text: turn.answer }] },
  ]);
}

function omittedImagesNote(count: number): string {
  return `[${count} screenshot(s) of this message are omitted from the history to save tokens; your answer below restates the task.]\n`;
}
