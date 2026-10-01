import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildModelChains } from '@/bootstrap/model-chain';
import { dedupeModels } from '@/core/application/services/resilient-llm';
import { DEFAULT_MODEL, DEFAULT_FALLBACKS } from '@/core/domain/model-route';

describe('buildModelChains', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds [primary, ...fallbacks] from env', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/primary');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/b,vendor/c');

    expect(buildModelChains().light).toEqual(['vendor/primary', 'vendor/b', 'vendor/c']);
  });

  it('trims each entry and drops blanks in the fallback list', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', '  vendor/primary  ');
    vi.stubEnv('VITE_MODEL_FALLBACKS', '  vendor/b ,, , vendor/c ,');

    expect(buildModelChains().light).toEqual(['vendor/primary', 'vendor/b', 'vendor/c']);
  });

  it('de-duplicates a primary that is repeated in the fallback list', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/a');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/a,vendor/b,vendor/a');

    expect(buildModelChains().light).toEqual(['vendor/a', 'vendor/b']);
  });

  it('falls back to the compiled-in defaults when both vars are blank', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', '');
    vi.stubEnv('VITE_MODEL_FALLBACKS', '');

    expect(buildModelChains().light).toEqual(dedupeModels([DEFAULT_MODEL, ...DEFAULT_FALLBACKS]));
  });

  it('uses the default fallback list when only the primary is overridden', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/primary');
    vi.stubEnv('VITE_MODEL_FALLBACKS', '');

    expect(buildModelChains().light).toEqual(
      dedupeModels(['vendor/primary', ...DEFAULT_FALLBACKS]),
    );
  });

  // The per-route seam (agents-improvement.md R11). The property that matters
  // for "nothing changed yet" is the first test below: without per-route vars,
  // both routes are the same chain.
  it('gives both routes the SAME chain when no per-route var is set', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/primary');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/b');

    const chains = buildModelChains();

    expect(chains.heavy).toEqual(chains.light);
    expect(chains.heavy).toEqual(['vendor/primary', 'vendor/b']);
  });

  it('overrides only the named route, leaving the other on the base chain', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/light-primary');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/shared-fallback');
    vi.stubEnv('VITE_HEAVY_MODEL', 'vendor/heavy-primary');

    const chains = buildModelChains();

    // Heavy takes its own primary but inherits the base fallback list.
    expect(chains.heavy).toEqual(['vendor/heavy-primary', 'vendor/shared-fallback']);
    expect(chains.light).toEqual(['vendor/light-primary', 'vendor/shared-fallback']);
  });

  it('lets a route override its fallback list independently of its primary', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/base');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/base-fallback');
    vi.stubEnv('VITE_HEAVY_MODEL_FALLBACKS', 'vendor/heavy-fallback-1, vendor/heavy-fallback-2');

    const chains = buildModelChains();

    expect(chains.heavy).toEqual([
      'vendor/base',
      'vendor/heavy-fallback-1',
      'vendor/heavy-fallback-2',
    ]);
    expect(chains.light).toEqual(['vendor/base', 'vendor/base-fallback']);
  });
});
