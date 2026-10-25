import { useCallback, useEffect, useMemo, useState } from 'react';
import { useServices } from './useServices';
import { SettingsValidationError } from '@/core/application/use-cases/manage-settings.use-case';
import {
  diffSettings,
  mergeSettings,
  validateSettings,
  type AppSettings,
  type SettingsErrors,
  type SettingsPatch,
} from '@/core/domain/settings';

export type SettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** What the settings forms render and call (props-in/callbacks-out). */
export interface SettingsForm {
  /** The effective settings (what the app runs with right now). */
  readonly settings: AppSettings;
  readonly defaults: AppSettings;
  /** The form's working copy. */
  readonly draft: AppSettings;
  /** The draft differs from the effective settings. */
  readonly dirty: boolean;
  /** Live validation of the draft: field path → message. */
  readonly errors: SettingsErrors;
  readonly status: SettingsSaveStatus;
  readonly error: string | null;
  /** Edit the draft. */
  readonly update: (patch: SettingsPatch) => void;
  /** Persist the draft's changes. */
  readonly save: () => Promise<void>;
  /** Throw the draft away. */
  readonly discard: () => void;
  /** Back to the build's defaults (persisted). */
  readonly reset: () => Promise<void>;
}

/**
 * Bridges the ⚙ settings forms to `ManageSettingsUseCase` (F2): keeps a
 * draft the forms edit, validates it live, and saves only what changed
 * (`diffSettings`) so untouched fields keep following the defaults. The
 * effective settings are tracked through the use-case's subscription, so a
 * change from elsewhere (a reset) shows up here too.
 */
export function useSettings(): SettingsForm {
  const { manageSettings } = useServices();
  const [settings, setSettings] = useState<AppSettings>(manageSettings.settings);
  const [draft, setDraft] = useState<AppSettings>(manageSettings.settings);
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<SettingsSaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSettings(manageSettings.settings);
    return manageSettings.subscribe(setSettings);
  }, [manageSettings]);

  // An untouched draft follows the effective settings (initial load, reset).
  useEffect(() => {
    if (!touched) setDraft(settings);
  }, [settings, touched]);

  const errors = useMemo(() => validateSettings(draft), [draft]);
  const dirty = useMemo(() => Object.keys(diffSettings(settings, draft)).length > 0, [settings, draft]);

  const update = useCallback((patch: SettingsPatch) => {
    setDraft((current) => mergeSettings(current, patch));
    setTouched(true);
    setStatus('idle');
    setError(null);
  }, []);

  const save = useCallback(async () => {
    if (Object.keys(errors).length > 0) {
      setStatus('error');
      setError('Исправьте ошибки в форме');
      return;
    }
    setStatus('saving');
    setError(null);
    try {
      await manageSettings.save(diffSettings(settings, draft));
      setTouched(false);
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(describe(err));
    }
  }, [manageSettings, settings, draft, errors]);

  const discard = useCallback(() => {
    setDraft(settings);
    setTouched(false);
    setStatus('idle');
    setError(null);
  }, [settings]);

  const reset = useCallback(async () => {
    setStatus('saving');
    setError(null);
    try {
      await manageSettings.reset();
      setTouched(false);
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(describe(err));
    }
  }, [manageSettings]);

  return {
    settings,
    defaults: manageSettings.defaultSettings,
    draft,
    dirty,
    errors,
    status,
    error,
    update,
    save,
    discard,
    reset,
  };
}

function describe(err: unknown): string {
  if (err instanceof SettingsValidationError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
