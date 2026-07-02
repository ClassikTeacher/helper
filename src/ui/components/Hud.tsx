import { useHudStore } from '@/ui/store/hud.store';
import { useAnalyzeScreenshot } from '@/ui/hooks/useAnalyzeScreenshot';
import { MessageList } from './MessageList';
import { PromptInput } from './PromptInput';

/**
 * The overlay HUD. Reads UI state from the store and delegates work to the
 * analyze-screenshot hook (which calls the injected use-case). No logic here.
 */
export function Hud() {
  const streaming = useHudStore((s) => s.streaming);
  const answer = useHudStore((s) => s.answer);
  const error = useHudStore((s) => s.error);
  const hotkeyError = useHudStore((s) => s.hotkeyError);
  const analyze = useAnalyzeScreenshot();

  return (
    <div className="mx-auto mt-8 w-[540px] rounded-xl border border-neutral-700 bg-neutral-900/95 p-4 shadow-2xl backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">AI-Helper</span>
        {streaming && <span className="text-xs text-indigo-400">streaming…</span>}
      </div>
      {hotkeyError && (
        <div className="mb-3 rounded-md border border-amber-600/50 bg-amber-950/50 px-3 py-2 text-xs text-amber-300">
          Не удалось зарегистрировать глобальный хоткей: {hotkeyError}
        </div>
      )}
      <div className="mb-3 max-h-[320px] overflow-y-auto">
        <MessageList answer={answer} streaming={streaming} error={error} />
      </div>
      <PromptInput disabled={streaming} onSubmit={analyze} />
    </div>
  );
}
