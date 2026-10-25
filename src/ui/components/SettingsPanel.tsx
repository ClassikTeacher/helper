import { useState, type FormEvent } from 'react';
import type { ApiKeySaveStatus } from '@/ui/hooks/useApiKeySettings';

interface SettingsPanelProps {
  readonly hasKey: boolean | null;
  readonly status: ApiKeySaveStatus;
  readonly error: string | null;
  readonly onSave: (value: string) => void;
  /** Remove the stored key (the keychain entry is deleted natively). */
  readonly onClear: () => void;
}

/**
 * Presentational: OpenRouter API key entry — props in, callback out, no I/O.
 *
 * Write-only by design: once saved, the key value is never read back into
 * this component (only whether one is configured). The renderer's only touch
 * of the actual secret is the moment it's typed here and handed to
 * `secret_set`; there is no native command that could return it
 * (architecture.md §11).
 */
export function SettingsPanel({ hasKey, status, error, onSave, onClear }: SettingsPanelProps) {
  const [value, setValue] = useState('');
  const busy = status === 'saving' || status === 'clearing';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onSave(trimmed);
    setValue('');
  };

  return (
    <div className="mb-3 rounded-md border border-neutral-700 bg-neutral-800/50 p-3">
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
    </div>
  );
}
