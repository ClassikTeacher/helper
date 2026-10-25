import type { SettingsPort } from '@/core/application/ports/settings.port';
import {
  SETTINGS_SCHEMA_VERSION,
  dropInvalidFields,
  mergePatches,
  mergeSettings,
  sanitizePatch,
  validateSettings,
  type AppSettings,
  type SettingsErrors,
  type SettingsPatch,
} from '@/core/domain/settings';

/** Thrown by `save` when the resulting settings would be invalid. */
export class SettingsValidationError extends Error {
  constructor(readonly errors: SettingsErrors) {
    super(`Настройки не сохранены: ${Object.values(errors).join('; ')}`);
    this.name = 'SettingsValidationError';
  }
}

export type SettingsListener = (settings: AppSettings) => void;

/**
 * Use-case: the current settings and how they change (F2). Holds the user's
 * stored PATCH and the effective settings (defaults + patch); `save` merges a
 * further patch in, validates the result and persists; `reset` empties the
 * patch. Subscribers (hotkey wiring, the HUD) see every change. Before
 * `load()` the effective settings are the defaults, so nothing waits on disk.
 */
export class ManageSettingsUseCase {
  private stored: SettingsPatch = {};
  private current: AppSettings;
  private readonly listeners = new Set<SettingsListener>();

  constructor(
    private readonly port: SettingsPort,
    private readonly defaults: AppSettings,
  ) {
    this.current = defaults;
  }

  /** The effective settings right now (defaults until `load` resolves). */
  get settings(): AppSettings {
    return this.current;
  }

  get defaultSettings(): AppSettings {
    return this.defaults;
  }

  /**
   * Reads the stored patch. Fields with a wrong type are dropped
   * (`sanitizePatch`); fields that are the right type but invalid (a
   * hand-edited accelerator) are dropped too, so a bad file never leaves the
   * app without its hotkeys.
   */
  async load(): Promise<AppSettings> {
    let stored = sanitizePatch(await this.port.load());
    for (let pass = 0; pass < 2; pass += 1) {
      const errors = validateSettings(mergeSettings(this.defaults, stored));
      if (Object.keys(errors).length === 0) break;
      stored = dropInvalidFields(stored, errors);
    }
    this.stored = stored;
    this.apply(mergeSettings(this.defaults, stored));
    return this.current;
  }

  /** Merges `patch` into the stored patch, validates, persists, notifies. */
  async save(patch: SettingsPatch): Promise<AppSettings> {
    const next = mergePatches(this.stored, patch);
    const merged = mergeSettings(this.defaults, next);
    const errors = validateSettings(merged);
    if (Object.keys(errors).length > 0) throw new SettingsValidationError(errors);
    await this.port.save({ schemaVersion: SETTINGS_SCHEMA_VERSION, ...next });
    this.stored = next;
    this.apply(merged);
    return merged;
  }

  /** Back to the build's defaults (an empty stored patch). */
  async reset(): Promise<AppSettings> {
    await this.port.save({ schemaVersion: SETTINGS_SCHEMA_VERSION });
    this.stored = {};
    this.apply(this.defaults);
    return this.defaults;
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private apply(next: AppSettings): void {
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
}
