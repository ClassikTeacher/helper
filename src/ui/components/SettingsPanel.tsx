import { useState, type FormEvent } from 'react';
import type { ApiKeySaveStatus } from '@/ui/hooks/useApiKeySettings';
import type { DiagnosticsCopyStatus } from '@/ui/hooks/useDiagnostics';
import type { SettingsForm } from '@/ui/hooks/useSettings';
import { HotkeysForm } from './settings/HotkeysForm';
import { RoutesForm } from './settings/RoutesForm';
import { AudioForm } from './settings/AudioForm';
import { PrivacyForm } from './settings/PrivacyForm';
import { SMALL_BUTTON_CLASS } from './settings/fields';

export type SettingsTab = 'key' | 'hotkeys' | 'models' | 'audio' | 'privacy';

const TABS: readonly { readonly id: SettingsTab; readonly label: string }[] = [
  { id: 'key', label: 'Ключ' },
  { id: 'hotkeys', label: 'Хоткеи' },
  { id: 'models', label: 'Модели' },
  { id: 'audio', label: 'Аудио' },
  { id: 'privacy', label: 'Приватность' },
];

interface SettingsPanelProps {
  readonly hasKey: boolean | null;
  readonly status: ApiKeySaveStatus;
  readonly error: string | null;
  readonly onSave: (value: string) => void;
  /** Remove the stored key (the keychain entry is deleted natively). */
  readonly onClear: () => void;
  /** Copy the diagnostics text (version, platform, native log tail) to the clipboard. */
  readonly onCopyDiagnostics: () => void;
  readonly diagnosticsStatus: DiagnosticsCopyStatus;
  /** The user settings form (F2): draft, errors, save/discard/reset. */
  readonly form: SettingsForm;
}

/**
 * Presentational: the ⚙ panel — API key + diagnostics on the first tab, the
 * user settings (hotkeys, model routes, audio, privacy) on the others. Props
 * in, callbacks out, no I/O.
 *
 * The key is write-only by design: once saved, its value is never read back
 * into this component (only whether one is configured). The renderer's only
 * touch of the actual secret is the moment it's typed here and handed to
 * `secret_set`; there is no native command that could return it
 * (architecture.md §11).
 */
export function SettingsPanel({
  hasKey,
  status,
  error,
  onSave,
  onClear,
  onCopyDiagnostics,
  diagnosticsStatus,
  form,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('key');
  const [value, setValue] = useState('');
  const busy = status === 'saving' || status === 'clearing';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSave(trimmed);
    setValue('');
  };

  const hasErrors = Object.keys(form.errors).length > 0;

  return (
    <div className="mb-3 rounded-md border border-neutral-700 bg-neutral-800/50 p-3">
      <div role="tablist" className="mb-3 flex gap-1 border-b border-neutral-700/70 pb-2 text-xs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded px-2 py-0.5 ${
              tab === item.id ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'key' && (
        <div>
          <p className="mb-2 text-xs font-medium text-neutral-300">OpenRouter API key</p>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              className="flex-1 rounded-md bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
              placeholder="sk-or-v1-…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <button
              type="submit"
              disabled={!value.trim() || busy}
              className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {status === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </form>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
            <p>
              {hasKey === null && 'Checking…'}
              {hasKey === true && 'Key configured ✓'}
              {hasKey === false && 'No key set yet — get one at openrouter.ai/keys'}
            </p>
            {hasKey === true && (
              <button
                type="button"
                onClick={onClear}
                disabled={busy}
                className="text-neutral-400 hover:text-red-300 disabled:opacity-50"
              >
                {status === 'clearing' ? 'Removing…' : 'Remove key'}
              </button>
            )}
          </div>
          {error && <p className="mt-1 text-xs text-red-400">Failed: {error}</p>}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-700/70 pt-2 text-xs text-neutral-500">
            <p>Diagnostics: version, platform and the last native log lines — no key, prompts or transcripts.</p>
            <button
              type="button"
              onClick={onCopyDiagnostics}
              disabled={diagnosticsStatus === 'copying'}
              className="shrink-0 rounded border border-neutral-600 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
            >
              {diagnosticsStatus === 'copying'
                ? 'Copying…'
                : diagnosticsStatus === 'copied'
                  ? '✓ Copied'
                  : diagnosticsStatus === 'error'
                    ? 'Copy failed — retry'
                    : 'Copy diagnostics'}
            </button>
          </div>
        </div>
      )}

      {tab === 'hotkeys' && (
        <HotkeysForm
          value={form.draft.hotkeys}
          errors={form.errors}
          onChange={(patch) => form.update({ hotkeys: patch })}
        />
      )}
      {tab === 'models' && (
        <RoutesForm
          value={form.draft.routes}
          errors={form.errors}
          onChange={(route, patch) => form.update({ routes: { [route]: patch } })}
        />
      )}
      {tab === 'audio' && (
        <AudioForm
          stt={form.draft.stt}
          recording={form.draft.recording}
          errors={form.errors}
          onChange={(patch) => form.update(patch)}
        />
      )}
      {tab === 'privacy' && (
        <PrivacyForm value={form.draft.provider} onChange={(patch) => form.update({ provider: patch })} />
      )}

      {tab !== 'key' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-neutral-700/70 pt-2 text-xs">
          <button
            type="button"
            onClick={() => void form.save()}
            disabled={!form.dirty || hasErrors || form.status === 'saving'}
            className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {form.status === 'saving' ? 'Сохраняю…' : 'Сохранить'}
          </button>
          <button type="button" onClick={form.discard} disabled={!form.dirty} className={SMALL_BUTTON_CLASS}>
            Отменить
          </button>
          <button
            type="button"
            onClick={() => void form.reset()}
            disabled={form.status === 'saving'}
            className={SMALL_BUTTON_CLASS}
            title="Вернуть значения по умолчанию из сборки (.env)"
          >
            Сбросить к умолчанию
          </button>
          <span className="text-neutral-500">
            {form.status === 'saved' && !form.dirty && 'Сохранено ✓'}
            {form.dirty && !hasErrors && 'Есть несохранённые изменения'}
            {hasErrors && 'Исправьте ошибки в форме'}
          </span>
          {form.error && <span className="basis-full text-red-400">{form.error}</span>}
        </div>
      )}
    </div>
  );
}
