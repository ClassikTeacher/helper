import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = {
  get: vi.fn(),
  set: vi.fn(async () => {}),
  save: vi.fn(async () => {}),
};

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => store),
}));

import { load } from '@tauri-apps/plugin-store';
import {
  SETTINGS_STORE_FILE,
  SETTINGS_STORE_KEY,
  TauriStoreSettingsAdapter,
} from '@/infrastructure/tauri/tauri-store-settings.adapter';

beforeEach(() => {
  vi.mocked(load).mockClear();
  store.get.mockReset();
  store.set.mockClear();
  store.save.mockClear();
});

describe('TauriStoreSettingsAdapter', () => {
  it('opens settings.json once (no autosave) and reads the document under the settings key', async () => {
    store.get.mockResolvedValue({ schemaVersion: 1, stt: { language: 'en' } });
    const adapter = new TauriStoreSettingsAdapter();

    expect(await adapter.load()).toEqual({ schemaVersion: 1, stt: { language: 'en' } });
    expect(await adapter.load()).toEqual({ schemaVersion: 1, stt: { language: 'en' } });

    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(SETTINGS_STORE_FILE, { autoSave: false, defaults: {} });
    expect(store.get).toHaveBeenCalledWith(SETTINGS_STORE_KEY);
  });

  it('returns null when nothing is stored yet', async () => {
    store.get.mockResolvedValue(undefined);
    expect(await new TauriStoreSettingsAdapter().load()).toBeNull();
  });

  it('save writes the document and flushes the store to disk', async () => {
    const adapter = new TauriStoreSettingsAdapter();
    await adapter.save({ schemaVersion: 1, recording: { windowSecs: 30 } });
    expect(store.set).toHaveBeenCalledWith(SETTINGS_STORE_KEY, { schemaVersion: 1, recording: { windowSecs: 30 } });
    expect(store.save).toHaveBeenCalledTimes(1);
  });
});
