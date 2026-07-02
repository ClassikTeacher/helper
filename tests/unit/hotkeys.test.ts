import { describe, it, expect, vi } from 'vitest';
import {
  registerHudHotkey,
  unregisterHudHotkey,
  TOGGLE_HUD_ACCELERATOR,
} from '@/bootstrap/hotkeys';
import type { HotkeyHandler, HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { OverlayPort } from '@/core/application/ports/overlay.port';

class FakeHotkeyPort implements HotkeyPort {
  private handlers = new Map<string, HotkeyHandler>();
  readonly registered: string[] = [];
  readonly unregistered: string[] = [];

  async register(accelerator: string, handler: HotkeyHandler): Promise<void> {
    this.registered.push(accelerator);
    this.handlers.set(accelerator, handler);
  }

  async unregister(accelerator: string): Promise<void> {
    this.unregistered.push(accelerator);
    this.handlers.delete(accelerator);
  }

  press(accelerator: string): void {
    this.handlers.get(accelerator)?.();
  }
}

function createFakeOverlay(): OverlayPort & { toggle: ReturnType<typeof vi.fn> } {
  return {
    show: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    toggle: vi.fn(async () => {}),
  };
}

describe('registerHudHotkey', () => {
  it('registers the HUD accelerator', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await registerHudHotkey({ platform: { hotkey, overlay } });

    expect(hotkey.registered).toEqual([TOGGLE_HUD_ACCELERATOR]);
  });

  it('toggles the overlay when the accelerator fires', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await registerHudHotkey({ platform: { hotkey, overlay } });
    hotkey.press(TOGGLE_HUD_ACCELERATOR);

    expect(overlay.toggle).toHaveBeenCalledTimes(1);
  });

  it('propagates registration failures instead of swallowing them', async () => {
    const hotkey: HotkeyPort = {
      register: vi.fn(async () => {
        throw new Error('shortcut already registered by another application');
      }),
      unregister: vi.fn(async () => {}),
    };
    const overlay = createFakeOverlay();

    await expect(registerHudHotkey({ platform: { hotkey, overlay } })).rejects.toThrow(
      'shortcut already registered by another application',
    );
  });
});

describe('unregisterHudHotkey', () => {
  it('unregisters the HUD accelerator', async () => {
    const hotkey = new FakeHotkeyPort();
    const overlay = createFakeOverlay();

    await unregisterHudHotkey({ platform: { hotkey, overlay } });

    expect(hotkey.unregistered).toEqual([TOGGLE_HUD_ACCELERATOR]);
  });
});
