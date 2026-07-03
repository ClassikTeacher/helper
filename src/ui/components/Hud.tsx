import { useState } from 'react';
import { useHudStore } from '@/ui/store/hud.store';
import { useAnalyzeScreenshot } from '@/ui/hooks/useAnalyzeScreenshot';
import { useApiKeySettings } from '@/ui/hooks/useApiKeySettings';
import { MessageList } from './MessageList';
import { PromptInput } from './PromptInput';
import { ScreenshotPreview } from './ScreenshotPreview';
import { SettingsPanel } from './SettingsPanel';

/**
 * The overlay HUD. Reads UI state from the store and delegates work to the
 * analyze-screenshot hook (which calls the injected use-case). No logic here.
 */
export function Hud() {
  const streaming = useHudStore((s) => s.streaming);
  const answer = useHudStore((s) => s.answer);
  const error = useHudStore((s) => s.error);
  const screenshot = useHudStore((s) => s.screenshot);
  const hotkeyError = useHudStore((s) => s.hotkeyError);
  const analyze = useAnalyzeScreenshot();
  const apiKey = useApiKeySettings();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="mx-auto mt-8 w-[540px] rounded-xl border border-neutral-700 bg-neutral-900/95 p-4 shadow-2xl backdrop-blur">
      {/*
        The header doubles as the window's drag handle. `data-tauri-drag-region`
        tells the OS to move the (undecorated) window when this element is
        dragged — the only way to reposition a frameless HUD.

        The value is `"deep"`, not a bare attribute, on purpose: a bare attribute
        only drags on a *direct* click on that exact element, and React renders
        a valueless `data-tauri-drag-region` as `="true"` (an undocumented value)
        — which left most of this thin header (its child wrappers) non-draggable.
        `"deep"` makes the whole header subtree a drag surface; Tauri still lets
        interactive elements block it, so the ⚙ button stays clickable and does
        not start a drag. `cursor-move`/`select-none` give the drag affordance
        and stop text selection while dragging.

        A drag region also maximizes the window on double-click (Tauri default),
        which is unwanted for a small fixed HUD — that is disabled declaratively
        via `maximizable: false` in tauri.conf.json (resizing from edges still
        works, since `resizable` stays true).
      */}
      <div
        data-tauri-drag-region="deep"
        className="mb-3 flex cursor-move select-none items-center justify-between"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          AI-Helper
        </span>
        <div className="flex items-center gap-3">
          {streaming && <span className="text-xs text-indigo-400">streaming…</span>}
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Settings"
            aria-pressed={settingsOpen}
            className="text-sm text-neutral-400 hover:text-neutral-200"
          >
            ⚙
          </button>
        </div>
      </div>
      {hotkeyError && (
        <div className="mb-3 rounded-md border border-amber-600/50 bg-amber-950/50 px-3 py-2 text-xs text-amber-300">
          Не удалось зарегистрировать глобальный хоткей: {hotkeyError}
        </div>
      )}
      {!settingsOpen && apiKey.hasKey === false && (
        <div className="mb-3 rounded-md border border-amber-600/50 bg-amber-950/50 px-3 py-2 text-xs text-amber-300">
          No OpenRouter API key configured — click ⚙ to add one.
        </div>
      )}
      {settingsOpen && (
        <SettingsPanel hasKey={apiKey.hasKey} status={apiKey.status} error={apiKey.error} onSave={apiKey.save} />
      )}
      <ScreenshotPreview screenshot={screenshot} />
      <div className="mb-3 max-h-[320px] overflow-y-auto">
        <MessageList answer={answer} streaming={streaming} error={error} />
      </div>
      <PromptInput disabled={streaming} onSubmit={analyze} />
    </div>
  );
}
