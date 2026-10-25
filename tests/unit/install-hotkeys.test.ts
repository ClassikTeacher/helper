import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installHotkeys, sameBindings } from '@/bootstrap/install-hotkeys';
import { ManageSettingsUseCase } from '@/core/application/use-cases/manage-settings.use-case';
import { InMemorySettingsAdapter } from '@/infrastructure/mocks/in-memory-settings.adapter';
import { useHudStore } from '@/ui/store/hud.store';
import type { HotkeyHandler, HotkeyPort } from '@/core/application/ports/hotkey.port';
import type { AppContainer } from '@/bootstrap/container.types';
import { BASE } from './settings.domain.test';

class FakeHotkeyPort implements HotkeyPort {
  readonly registered: string[] = [];
  readonly unregistered: string[] = [];
  failing = new Set<string>();

  async register(accelerator: string, _handler: HotkeyHandler): Promise<void> {
    if (this.failing.has(accelerator)) throw new Error(`HotKey already registered: ${accelerator}`);
    this.registered.push(accelerator);
  }

  async unregister(accelerator: string): Promise<void> {
    this.unregistered.push(accelerator);
  }
}

function createContainer(hotkey: HotkeyPort) {
  const overlay = { show: vi.fn(async () => {}), hide: vi.fn(async () => {}), toggle: vi.fn(async () => {}), isVisible: async () => false };
  const container: Pick<AppContainer, 'platform' | 'useCases'> = {
    platform: { hotkey, overlay, clipboard: { readText: async () => '' }, tray: { onAction: async () => () => {} } },
    useCases: {} as AppContainer['useCases'],
  };
  return { container, overlay };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useHudStore.setState({ hotkeyError: null });
});

describe('installHotkeys (F2)', () => {
  it('registers the current bindings, then swaps them when the settings change', async () => {
    const hotkey = new FakeHotkeyPort();
    const { container } = createContainer(hotkey);
    const settings = new ManageSettingsUseCase(new InMemorySettingsAdapter(null), BASE);

    const dispose = installHotkeys(container, settings);
    await flush();
    expect(hotkey.registered).toEqual(Object.values(BASE.hotkeys));

    await settings.save({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+1' } });
    await flush();
    await flush();
    expect(hotkey.unregistered).toEqual(Object.values(BASE.hotkeys));
    expect(hotkey.registered.slice(6)).toEqual(
      Object.values({ ...BASE.hotkeys, capture: 'CommandOrControl+Alt+Shift+1' }),
    );

    // A save that leaves the bindings alone touches nothing.
    await settings.save({ recording: { windowSecs: 30 } });
    await flush();
    expect(hotkey.registered).toHaveLength(12);

    dispose();
    await flush();
    expect(hotkey.unregistered).toHaveLength(12);
    expect(hotkey.unregistered.slice(6)).toContain('CommandOrControl+Alt+Shift+1');
  });

  it('surfaces a registration failure in the HUD and clears it once a later registration succeeds', async () => {
    const hotkey = new FakeHotkeyPort();
    hotkey.failing.add(BASE.hotkeys.capture);
    const { container, overlay } = createContainer(hotkey);
    const settings = new ManageSettingsUseCase(new InMemorySettingsAdapter(null), BASE);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    installHotkeys(container, settings);
    await flush();
    expect(useHudStore.getState().hotkeyError).toContain('HotKey already registered');
    expect(overlay.show).toHaveBeenCalled();

    await settings.save({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+2' } });
    await flush();
    await flush();
    expect(useHudStore.getState().hotkeyError).toBeNull();
    consoleError.mockRestore();
  });

  it('sameBindings compares every action', () => {
    expect(sameBindings(BASE.hotkeys, { ...BASE.hotkeys })).toBe(true);
    expect(sameBindings(BASE.hotkeys, { ...BASE.hotkeys, pasteCode: 'Alt+P' })).toBe(false);
  });
});
