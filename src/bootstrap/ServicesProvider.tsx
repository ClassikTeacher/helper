import { createContext, useEffect, useMemo, type ReactNode } from 'react';
import { createContainer } from './container';
import { registerHotkeys, unregisterHotkeys } from './hotkeys';
import { installTrayActions } from './tray-actions';
import { useHudStore } from '@/ui/store/hud.store';
import type { AppContainer, ContainerOverrides } from './container.types';

export const ServicesContext = createContext<AppContainer | null>(null);

interface ServicesProviderProps {
  readonly children: ReactNode;
  /** Inject a prebuilt container (tests) or overrides (dev). */
  readonly container?: AppContainer;
  readonly overrides?: ContainerOverrides;
}

/**
 * Provides the DI container to the React tree. Components read use-cases via
 * `useServices()` and never construct their own dependencies.
 *
 * This is also where the platform-level hotkey/overlay wiring lives (phase
 * 0.3): the global hotkey is registered once per container instance, never
 * inside a component (architecture.md §8, container.types.ts).
 */
export function ServicesProvider({ children, container, overrides }: ServicesProviderProps) {
  const value = useMemo(
    () => container ?? createContainer(overrides ?? {}),
    [container, overrides],
  );

  useEffect(() => {
    // F1: tray-menu actions (stop recording = send) share the hotkey paths.
    let disposed = false;
    let disposeTray: (() => void) | null = null;
    installTrayActions(value)
      .then((dispose) => {
        if (disposed) dispose();
        else disposeTray = dispose;
      })
      .catch((err) => {
        console.error('Failed to subscribe to tray actions', err);
      });
    registerHotkeys(value).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to register global hotkeys', err);
      // No tray/notification yet (tasks.md phase 0.3) — surface the failure by
      // showing the HUD itself, otherwise the user has no way to find out a
      // main entry point (a hotkey) is silently non-functional.
      useHudStore.getState().setHotkeyError(message);
      void value.platform.overlay.show();
    });
    return () => {
      disposed = true;
      disposeTray?.();
      unregisterHotkeys(value).catch((err) => {
        console.error('Failed to unregister global hotkeys', err);
      });
    };
  }, [value]);

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}
