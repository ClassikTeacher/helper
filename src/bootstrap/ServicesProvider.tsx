import { createContext, useEffect, useMemo, type ReactNode } from 'react';
import { createContainer } from './container';
import { installHotkeys } from './install-hotkeys';
import { installTrayActions } from './tray-actions';
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
    // Hotkeys follow the settings (F2): registered now, re-registered on save.
    const disposeHotkeys = installHotkeys(value, value.useCases.manageSettings);
    return () => {
      disposed = true;
      disposeTray?.();
      disposeHotkeys();
    };
  }, [value]);

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}
