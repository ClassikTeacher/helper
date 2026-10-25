import { describe, it, expect } from 'vitest';
import { acceleratorFromKeyPress } from '@/ui/lib/accelerator';

const press = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('acceleratorFromKeyPress', () => {
  it('builds Tauri accelerators from physical keys and modifiers', () => {
    expect(acceleratorFromKeyPress(press('KeyK', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe(
      'CommandOrControl+Alt+Shift+K',
    );
    expect(acceleratorFromKeyPress(press('Enter', { ctrlKey: true, altKey: true }))).toBe('CommandOrControl+Alt+Enter');
    expect(acceleratorFromKeyPress(press('Digit1', { altKey: true }))).toBe('Alt+1');
    expect(acceleratorFromKeyPress(press('F12', { metaKey: true }))).toBe('Super+F12');
    expect(acceleratorFromKeyPress(press('Numpad5', { ctrlKey: true }))).toBe('CommandOrControl+Num5');
    expect(acceleratorFromKeyPress(press('Minus', { ctrlKey: true, shiftKey: true }))).toBe('CommandOrControl+Shift+-');
    expect(acceleratorFromKeyPress(press('ArrowUp', { altKey: true }))).toBe('Alt+Up');
  });

  it('ignores modifier-only and unknown keys', () => {
    expect(acceleratorFromKeyPress(press('ControlLeft', { ctrlKey: true }))).toBeNull();
    expect(acceleratorFromKeyPress(press('ShiftRight', { shiftKey: true }))).toBeNull();
    expect(acceleratorFromKeyPress(press('MediaPlayPause'))).toBeNull();
  });

  it('is layout-independent: a Cyrillic layout still yields the Latin key', () => {
    // `code` is the physical key regardless of the active layout.
    expect(acceleratorFromKeyPress(press('KeyR', { ctrlKey: true, altKey: true, shiftKey: true }))).toBe(
      'CommandOrControl+Alt+Shift+R',
    );
  });
});
