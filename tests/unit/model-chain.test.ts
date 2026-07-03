import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildModelChain } from '@/bootstrap/model-chain';
import { dedupeModels } from '@/core/application/services/resilient-llm';
import { DEFAULT_MODEL, DEFAULT_FALLBACKS } from '@/core/domain/model-route';

describe('buildModelChain', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds [primary, ...fallbacks] from env', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/primary');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/b,vendor/c');

    expect(buildModelChain()).toEqual(['vendor/primary', 'vendor/b', 'vendor/c']);
  });

  it('trims each entry and drops blanks in the fallback list', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', '  vendor/primary  ');
    vi.stubEnv('VITE_MODEL_FALLBACKS', '  vendor/b ,, , vendor/c ,');

    expect(buildModelChain()).toEqual(['vendor/primary', 'vendor/b', 'vendor/c']);
  });

  it('de-duplicates a primary that is repeated in the fallback list', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/a');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/a,vendor/b,vendor/a');

    expect(buildModelChain()).toEqual(['vendor/a', 'vendor/b']);
  });

  it('falls back to the compiled-in defaults when both vars are blank', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', '');
    vi.stubEnv('VITE_MODEL_FALLBACKS', '');

    expect(buildModelChain()).toEqual(dedupeModels([DEFAULT_MODEL, ...DEFAULT_FALLBACKS]));
  });

  it('uses the default fallback list when only the primary is overridden', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/primary');
    vi.stubEnv('VITE_MODEL_FALLBACKS', '');

    expect(buildModelChain()).toEqual(dedupeModels(['vendor/primary', ...DEFAULT_FALLBACKS]));
  });
});
