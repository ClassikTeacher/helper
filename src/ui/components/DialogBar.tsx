interface DialogBarProps {
  /** Messages of the current mode's dialog kept as context (0 = new dialog). */
  readonly turnCount: number;
  readonly disabled?: boolean;
  readonly onNewDialog: () => void;
}

/**
 * Presentational: shows how much context the current mode's dialog carries and
 * starts a new dialog (clean context) for this mode only. No logic inside.
 */
export function DialogBar({ turnCount, disabled = false, onNewDialog }: DialogBarProps) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 text-xs">
      <span
        className="text-neutral-500"
        title="Сколько прошлых вопросов и ответов этого режима уйдёт в модель вместе со следующим сообщением"
      >
        {turnCount === 0 ? 'Новый диалог' : `В контексте: ${turnCount} ${questionsWord(turnCount)}`}
      </span>
      <button
        type="button"
        onClick={onNewDialog}
        disabled={disabled || turnCount === 0}
        title="Начать новый диалог в этом режиме — прошлые вопросы перестанут уходить в модель"
        className="rounded border border-neutral-600 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
      >
        ＋ Новый диалог
      </button>
    </div>
  );
}

/** Russian plural of «вопрос» for a count. */
function questionsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'вопрос';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'вопроса';
  return 'вопросов';
}
