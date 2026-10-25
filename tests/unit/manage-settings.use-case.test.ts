import { describe, it, expect, vi } from 'vitest';
import {
  ManageSettingsUseCase,
  SettingsValidationError,
} from '@/core/application/use-cases/manage-settings.use-case';
import { InMemorySettingsAdapter } from '@/infrastructure/mocks/in-memory-settings.adapter';
import { BASE } from './settings.domain.test';

describe('ManageSettingsUseCase', () => {
  it('serves the defaults before load and the merged settings after', async () => {
    const port = new InMemorySettingsAdapter({
      schemaVersion: 1,
      hotkeys: { capture: 'CommandOrControl+Alt+Shift+1' },
      recording: { windowSecs: 30 },
    });
    const useCase = new ManageSettingsUseCase(port, BASE);
    expect(useCase.settings).toEqual(BASE);

    const loaded = await useCase.load();
    expect(loaded.hotkeys.capture).toBe('CommandOrControl+Alt+Shift+1');
    expect(loaded.hotkeys.send).toBe(BASE.hotkeys.send);
    expect(loaded.recording.windowSecs).toBe(30);
    expect(useCase.settings).toBe(loaded);
  });

  it('load drops stored fields that are invalid (never leaves the app without hotkeys)', async () => {
    const port = new InMemorySettingsAdapter({
      schemaVersion: 1,
      hotkeys: { capture: 'Shift+K', send: 'CommandOrControl+Alt+Shift+9' },
      stt: { silenceDbfs: 12 },
    });
    const loaded = await new ManageSettingsUseCase(port, BASE).load();
    expect(loaded.hotkeys.capture).toBe(BASE.hotkeys.capture);
    expect(loaded.hotkeys.send).toBe('CommandOrControl+Alt+Shift+9');
    expect(loaded.stt.silenceDbfs).toBe(BASE.stt.silenceDbfs);
  });

  it('save merges into the stored patch, persists the versioned document and notifies', async () => {
    const port = new InMemorySettingsAdapter({ schemaVersion: 1, stt: { language: 'en' } });
    const useCase = new ManageSettingsUseCase(port, BASE);
    await useCase.load();
    const listener = vi.fn();
    useCase.subscribe(listener);

    const next = await useCase.save({ hotkeys: { record: 'CommandOrControl+Alt+Shift+M' }, provider: { zdr: true } });

    expect(next.hotkeys.record).toBe('CommandOrControl+Alt+Shift+M');
    expect(next.stt.language).toBe('en');
    expect(next.provider.zdr).toBe(true);
    expect(port.document).toEqual({
      schemaVersion: 1,
      stt: { language: 'en' },
      hotkeys: { record: 'CommandOrControl+Alt+Shift+M' },
      provider: { zdr: true },
    });
    expect(listener).toHaveBeenCalledWith(next);
    expect(useCase.settings).toBe(next);
  });

  it('save rejects an invalid result without persisting anything', async () => {
    const port = new InMemorySettingsAdapter(null);
    const useCase = new ManageSettingsUseCase(port, BASE);
    const listener = vi.fn();
    useCase.subscribe(listener);

    await expect(useCase.save({ hotkeys: { capture: 'Shift+K' } })).rejects.toBeInstanceOf(SettingsValidationError);
    await expect(useCase.save({ hotkeys: { capture: 'Shift+K' } })).rejects.toMatchObject({
      errors: { 'hotkeys.capture': expect.any(String) },
    });
    expect(port.document).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(useCase.settings).toEqual(BASE);
  });

  it('reset empties the stored patch and returns to the defaults', async () => {
    const port = new InMemorySettingsAdapter({ schemaVersion: 1, recording: { windowSecs: 30 } });
    const useCase = new ManageSettingsUseCase(port, BASE);
    await useCase.load();
    const listener = vi.fn();
    const unsubscribe = useCase.subscribe(listener);

    await useCase.reset();
    expect(useCase.settings).toEqual(BASE);
    expect(port.document).toEqual({ schemaVersion: 1 });
    expect(listener).toHaveBeenCalledWith(BASE);

    unsubscribe();
    await useCase.save({ recording: { windowSecs: 45 } });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
