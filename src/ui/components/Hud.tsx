import { useState } from 'react';
import { useHudStore, MAX_SCREENSHOTS } from '@/ui/store/hud.store';
import { useAnalyzeScreenshot } from '@/ui/hooks/useAnalyzeScreenshot';
import { useToggleRecording } from '@/ui/hooks/useToggleRecording';
import { useApiKeySettings } from '@/ui/hooks/useApiKeySettings';
import { AGENT_LIST, resolveAgent } from '@/core/domain/agents-catalog';
import { AgentSwitch } from './AgentSwitch';
import { AudioControls } from './AudioControls';
import { LanguageSelect } from './LanguageSelect';
import { MessageList } from './MessageList';
import { PromptInput } from './PromptInput';
import { ScreenshotStrip } from './ScreenshotStrip';
import { SettingsPanel } from './SettingsPanel';

/**
 * The overlay HUD. Reads UI state from the store and delegates work to the
 * analyze-screenshot hook (which calls the injected use-case). No logic here.
 */
export function Hud() {
  const streaming = useHudStore((s) => s.streaming);
  const answer = useHudStore((s) => s.answer);
  const error = useHudStore((s) => s.error);
  const screenshots = useHudStore((s) => s.screenshots);
  const hotkeyError = useHudStore((s) => s.hotkeyError);
  const agentId = useHudStore((s) => s.agentId);
  const language = useHudStore((s) => s.language);
  const instructions = useHudStore((s) => s.instructions);
  const activeHint = useHudStore((s) => s.activeHint);
  const recording = useHudStore((s) => s.recording);
  const transcribing = useHudStore((s) => s.transcribing);
  const transcript = useHudStore((s) => s.transcript);
  const setAgentId = useHudStore((s) => s.setAgentId);
  const setLanguage = useHudStore((s) => s.setLanguage);
  const setInstructions = useHudStore((s) => s.setInstructions);
  const removeScreenshot = useHudStore((s) => s.removeScreenshot);
  const clearScreenshots = useHudStore((s) => s.clearScreenshots);
  const analyze = useAnalyzeScreenshot();
  const toggleRecording = useToggleRecording();
  const apiKey = useApiKeySettings();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedAgent = resolveAgent(agentId);

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
        not start a drag. `select-none` stops text selection while dragging. The
        drag cursor is intentionally NOT shown (no `cursor-move`) — the HUD keeps
        one constant cursor everywhere (see the global rule in styles/index.css).

        A drag region also maximizes the window on double-click (Tauri default),
        which is unwanted for a small fixed HUD — that is disabled declaratively
        via `maximizable: false` in tauri.conf.json (resizing from edges still
        works, since `resizable` stays true).
      */}
      <div
        data-tauri-drag-region="deep"
        className="mb-3 flex select-none items-center justify-between"
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
      {/* Agent switch + (solver-only) language selector. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <AgentSwitch agents={AGENT_LIST} selected={agentId} disabled={streaming} onSelect={setAgentId} />
        {selectedAgent.requiresLanguage && (
          <LanguageSelect value={language} disabled={streaming} onChange={setLanguage} />
        )}
      </div>
      <ScreenshotStrip
        screenshots={screenshots}
        max={MAX_SCREENSHOTS}
        onRemove={removeScreenshot}
        onClear={clearScreenshots}
      />
      <AudioControls
        recording={recording}
        transcribing={transcribing}
        transcript={transcript}
        onToggle={toggleRecording}
        disabled={streaming || transcribing}
      />
      {/* Shows that the current answer used an extra hint, not just the screenshot. */}
      {activeHint && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-indigo-700/50 bg-indigo-950/40 px-3 py-2 text-xs text-indigo-200">
          <span className="font-semibold uppercase tracking-wide text-indigo-400">Hint</span>
          <span className="break-words">{activeHint}</span>
        </div>
      )}
      <div className="mb-3 max-h-[320px] overflow-y-auto">
        <MessageList answer={answer} streaming={streaming} error={error} />
      </div>
      <PromptInput
        value={instructions}
        disabled={streaming}
        onChange={setInstructions}
        onSubmit={analyze}
      />
    </div>
  );
}
