import { useContext } from 'react';
import { ServicesContext } from '@/bootstrap/ServicesProvider';
import type { AppContainer } from '@/bootstrap/container.types';

/**
 * Access the injected use-cases. Components use ONLY this to reach logic — never
 * importing adapters or calling `invoke`/`fetch` directly (architecture.md §8).
 */
export function useServices(): AppContainer['useCases'] {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error('useServices must be used within <ServicesProvider>');
  return ctx.useCases;
}
