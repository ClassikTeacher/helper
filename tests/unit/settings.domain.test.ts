import { describe, it, expect } from 'vitest';
import {
  diffSettings,
  dropInvalidFields,
  fromRouteProfiles,
  isValidAccelerator,
  mergePatches,
  mergeSettings,
  sanitizePatch,
  toRouteProfiles,
  validateSettings,
  type AppSettings,
} from '@/core/domain/settings';

export const BASE: AppSettings = {
  hotkeys: {
    toggleHud: 'CommandOrControl+Alt+Shift+H',
    capture: 'CommandOrControl+Alt+Shift+K',
    captureWindow: 'CommandOrControl+Alt+Shift+W',
    send: 'CommandOrControl+Alt+Shift+Enter',
    record: 'CommandOrControl+Alt+Shift+R',
    pasteCode: 'CommandOrControl+Alt+Shift+P',
  },
  routes: {
    light: { chain: ['vendor/a', 'vendor/b'], temperature: 0.3, reasoningEffort: null, maxImageEdge: 1568 },
    heavy: { chain: ['vendor/c'], temperature: null, reasoningEffort: 'medium', maxImageEdge: 2576 },
  },
  stt: { language: 'ru', prompt: '', silenceGate: true, silenceDbfs: -50 },
  recording: { windowSecs: 60 },
  provider: { dataCollection: 'deny', zdr: false },
};

describe('settings: merge / diff', () => {
  it('mergeSettings applies a patch field by field and ignores undefined', () => {
    const merged = mergeSettings(BASE, {
      hotkeys: { capture: 'CommandOrControl+Alt+Shift+1', send: undefined } as unknown as Partial<AppSettings['hotkeys']>,
      routes: { heavy: { chain: ['vendor/z'] } },
      stt: { language: 'en' },
    });
    expect(merged.hotkeys.capture).toBe('CommandOrControl+Alt+Shift+1');
    expect(merged.hotkeys.send).toBe(BASE.hotkeys.send);
    expect(merged.routes.heavy).toEqual({ ...BASE.routes.heavy, chain: ['vendor/z'] });
    expect(merged.routes.light).toEqual(BASE.routes.light);
    expect(merged.stt).toEqual({ ...BASE.stt, language: 'en' });
    expect(merged.recording).toEqual(BASE.recording);
  });

  it('diffSettings yields only what changed, and merging it back reproduces the target', () => {
    const target = mergeSettings(BASE, {
      hotkeys: { record: 'CommandOrControl+Alt+Shift+M' },
      routes: { light: { chain: ['vendor/a'], temperature: null } },
      provider: { zdr: true },
    });
    const patch = diffSettings(BASE, target);
    expect(patch).toEqual({
      hotkeys: { record: 'CommandOrControl+Alt+Shift+M' },
      routes: { light: { chain: ['vendor/a'], temperature: null } },
      provider: { zdr: true },
    });
    expect(mergeSettings(BASE, patch)).toEqual(target);
    expect(diffSettings(BASE, BASE)).toEqual({});
  });

  it('mergePatches accumulates, the later patch winning per field', () => {
    const merged = mergePatches(
      { hotkeys: { capture: 'A+B', send: 'C+D' }, stt: { language: 'en' } },
      { hotkeys: { capture: 'Alt+E' }, recording: { windowSecs: 30 } },
    );
    expect(merged).toEqual({
      hotkeys: { capture: 'Alt+E', send: 'C+D' },
      stt: { language: 'en' },
      recording: { windowSecs: 30 },
    });
  });
});

describe('settings: sanitizePatch', () => {
  it('keeps known fields with the right types and drops the rest', () => {
    const patch = sanitizePatch({
      schemaVersion: 1,
      hotkeys: { capture: 'Alt+K', send: 42, unknown: 'x' },
      routes: {
        light: { chain: ['vendor/a', 5], temperature: null, reasoningEffort: 'bogus', maxImageEdge: 1000 },
        heavy: { chain: ['vendor/b'], reasoningEffort: 'high' },
        weird: { chain: [] },
      },
      stt: { language: 'en', silenceGate: 'yes', silenceDbfs: -40 },
      recording: { windowSecs: '30' },
      provider: { dataCollection: 'allow', zdr: 1 },
      extra: true,
    });
    expect(patch).toEqual({
      hotkeys: { capture: 'Alt+K' },
      routes: {
        light: { temperature: null, maxImageEdge: 1000 },
        heavy: { chain: ['vendor/b'], reasoningEffort: 'high' },
      },
      stt: { language: 'en', silenceDbfs: -40 },
      provider: { dataCollection: 'allow' },
    });
  });

  it('returns an empty patch for a missing or malformed document', () => {
    expect(sanitizePatch(null)).toEqual({});
    expect(sanitizePatch('nope')).toEqual({});
    expect(sanitizePatch([1, 2])).toEqual({});
    expect(sanitizePatch({ hotkeys: 'Alt+K' })).toEqual({});
  });
});

describe('settings: validateSettings', () => {
  it('accepts the base settings', () => {
    expect(validateSettings(BASE)).toEqual({});
  });

  it('flags bad accelerators and duplicates', () => {
    const errors = validateSettings(
      mergeSettings(BASE, {
        hotkeys: { capture: 'Shift+K', send: 'CommandOrControl+Alt+Shift+H', pasteCode: '' },
      }),
    );
    expect(Object.keys(errors).sort()).toEqual(['hotkeys.capture', 'hotkeys.pasteCode', 'hotkeys.send', 'hotkeys.toggleHud']);
    expect(errors['hotkeys.send']).toContain('toggleHud');
  });

  it('flags route, stt, recording and provider problems with their field paths', () => {
    const errors = validateSettings(
      mergeSettings(BASE, {
        routes: {
          light: { chain: [], temperature: 3 },
          heavy: { chain: ['not a slug'], maxImageEdge: 100 },
        },
        stt: { language: 'russian!', silenceDbfs: 5, prompt: 'x'.repeat(601) },
        recording: { windowSecs: 1 },
        provider: { dataCollection: 'maybe' as 'deny' },
      }),
    );
    expect(Object.keys(errors).sort()).toEqual([
      'provider.dataCollection',
      'recording.windowSecs',
      'routes.heavy.chain',
      'routes.heavy.maxImageEdge',
      'routes.light.chain',
      'routes.light.temperature',
      'stt.language',
      'stt.prompt',
      'stt.silenceDbfs',
    ]);
  });

  it('dropInvalidFields removes exactly the offending fields from a patch', () => {
    const patch = {
      hotkeys: { capture: 'Shift+K', send: 'Alt+S' },
      routes: { light: { chain: [], maxImageEdge: 900 } },
      recording: { windowSecs: 1 },
    };
    const cleaned = dropInvalidFields(patch, {
      'hotkeys.capture': 'bad',
      'routes.light.chain': 'bad',
      'recording.windowSecs': 'bad',
    });
    expect(cleaned).toEqual({ hotkeys: { send: 'Alt+S' }, routes: { light: { maxImageEdge: 900 } }, recording: {} });
  });
});

describe('settings: accelerators and routes', () => {
  it('isValidAccelerator requires modifiers (not Shift alone) plus one key', () => {
    for (const ok of [
      'CommandOrControl+Alt+Shift+K',
      'Ctrl+Alt+Enter',
      'Alt+F12',
      'Super+Shift+Space',
      'CmdOrCtrl+Alt+1',
      'Control+Alt+-',
    ]) {
      expect(isValidAccelerator(ok), ok).toBe(true);
    }
    for (const bad of ['K', 'Shift+K', 'Ctrl+', 'Ctrl+Alt', 'Bogus+K', 'Ctrl+K+L', 'Ctrl+Hyper', '']) {
      expect(isValidAccelerator(bad), bad).toBe(false);
    }
  });

  it('round-trips route profiles (null ↔ undefined for optional params)', () => {
    const profiles = toRouteProfiles(BASE.routes);
    expect(profiles.light).toEqual({ chain: ['vendor/a', 'vendor/b'], temperature: 0.3, maxImageEdge: 1568 });
    expect(profiles.heavy).toEqual({ chain: ['vendor/c'], reasoningEffort: 'medium', maxImageEdge: 2576 });
    expect(fromRouteProfiles(profiles)).toEqual(BASE.routes);
  });
});
