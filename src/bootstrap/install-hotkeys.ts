import { useHudStore } from '@/ui/store/hud.store';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import type { ManageSettingsUseCase } from '@/core/application/use-cases/manage-settings.use-case';
import { HOTKEY_ACTIONS, type HotkeySettings } from '@/core/domain/settings';
import type { AppContainer } from './container.types';

type HotkeysContainer = Pick<AppContainer, 'platform' | 'useCases'>;

/**
 * Registers the global hotkeys for the CURRENT settings and keeps them in
 * sync (F2): when the user saves new bindings in ⚙, the old accelerators are
 * unregistered and the new ones registered — no restart. Registration
 * failures (an accelerator taken by another app) are surfaced in the HUD's
 * hotkey banner and never swallowed; a later successful registration clears
 * it. Returns the disposer.
 */
export function installHotkeys(container: HotkeysContainer, settings: ManageSettingsUseCase): () => void {
  let bindings = settings.settings.hotkeys;
  // All (un)registration goes through one chain so a fast double save cannot
  // interleave unregister/register of two generations.
  let chain: Promise<void> = apply(bindings);

  const unsubscribe = settings.subscribe((next) => {
    if (sameBindings(next.hotkeys, bindings)) return;
    const previous = bindings;
    bindings = next.hotkeys;
    chain = chain
      .then(() => unregisterHotkeys(container, previous))
      .then(() => apply(bindings));
  });

  return () => {
    unsubscribe();
    chain = chain.then(() => unregisterHotkeys(container, bindings));
  };

  async function apply(current: HotkeySettings): Promise<void> {
    try {
      await registerHotkeys(container, current);
      useHudStore.getState().setHotkeyError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to register global hotkeys', err);
      // No other channel than the HUD itself: show it with the banner, or the
      // user never learns a main entry point is silently non-functional.
      useHudStore.getState().setHotkeyError(message);
      await container.platform.overlay.show().catch(() => {});
    }
  }
}

export function sameBindings(a: HotkeySettings, b: HotkeySettings): boolean {
  return HOTKEY_ACTIONS.every((action) => a[action] === b[action]);
}
