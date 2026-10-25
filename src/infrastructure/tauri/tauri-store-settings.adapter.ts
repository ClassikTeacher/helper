import { load, type Store } from '@tauri-apps/plugin-store';
import type { SettingsPort } from '@/core/application/ports/settings.port';
import type { SettingsDocument } from '@/core/domain/settings';

/** The store file (in the app's config dir) and the key holding the document. */
export const SETTINGS_STORE_FILE = 'settings.json';
export const SETTINGS_STORE_KEY = 'settings';

/**
 * SettingsPort over `tauri-plugin-store` (F2): one JSON file,
 * `%APPDATA%\com.aihelper.app\settings.json`, with the user's patch under
 * the `settings` key. Explicit `save()` (no autosave) so a half-typed form
 * never hits the disk. The file holds no secrets — the API key stays in the
 * OS keychain.
 */
export class TauriStoreSettingsAdapter implements SettingsPort {
  private store: Promise<Store> | null = null;

  async load(): Promise<unknown> {
    const store = await this.open();
    return (await store.get<unknown>(SETTINGS_STORE_KEY)) ?? null;
  }

  async save(document: SettingsDocument): Promise<void> {
    const store = await this.open();
    await store.set(SETTINGS_STORE_KEY, document);
    await store.save();
  }

  private open(): Promise<Store> {
    this.store ??= load(SETTINGS_STORE_FILE, { autoSave: false, defaults: {} });
    return this.store;
  }
}
