import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildModelChain,
  buildModelRoutes,
  parseImageEdge,
  parseReasoning,
  parseTemperature,
} from '@/bootstrap/model-chain';
import { dedupeModels } from '@/core/application/services/resilient-llm';
import {
  DEFAULT_MODEL,
  DEFAULT_FALLBACKS,
  DEFAULT_MAX_IMAGE_EDGE,
  DEFAULT_TEMPERATURE,
} from '@/core/domain/model-route';

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

describe('buildModelRoutes (R11/R16)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('gives both routes the SAME chain and parameters when no per-route var is set', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/base');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/fb');

    const routes = buildModelRoutes();

    expect(routes.light).toEqual(routes.heavy);
    expect(routes.light).toEqual({
      chain: ['vendor/base', 'vendor/fb'],
      temperature: DEFAULT_TEMPERATURE,
      maxImageEdge: DEFAULT_MAX_IMAGE_EDGE,
    });
  });

  it('applies per-route overrides only to their route', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/base');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/fb');
    vi.stubEnv('VITE_HEAVY_MODEL', 'anthropic/claude-sonnet-5');
    vi.stubEnv('VITE_HEAVY_MODEL_FALLBACKS', 'vendor/strong');
    vi.stubEnv('VITE_HEAVY_TEMPERATURE', 'off');
    vi.stubEnv('VITE_HEAVY_REASONING', 'medium');
    vi.stubEnv('VITE_HEAVY_MAX_IMAGE_EDGE', '2576');

    const routes = buildModelRoutes();

    expect(routes.heavy).toEqual({
      chain: ['anthropic/claude-sonnet-5', 'vendor/strong'],
      reasoningEffort: 'medium',
      maxImageEdge: 2576,
    });
    expect(routes.light.chain).toEqual(['vendor/base', 'vendor/fb']);
  });

  it('keeps the base fallbacks when only a route primary is overridden', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/base');
    vi.stubEnv('VITE_MODEL_FALLBACKS', 'vendor/fb');
    vi.stubEnv('VITE_HEAVY_MODEL', 'vendor/deep');

    expect(buildModelRoutes().heavy.chain).toEqual(['vendor/deep', 'vendor/fb']);
  });
});

describe('route env parsers', () => {
  it('parseTemperature: default, off, valid number, invalid → default', () => {
    expect(parseTemperature(undefined)).toBe(DEFAULT_TEMPERATURE);
    expect(parseTemperature('off')).toBeUndefined();
    expect(parseTemperature('0')).toBe(0);
    expect(parseTemperature('0.7')).toBe(0.7);
    expect(parseTemperature('hot')).toBe(DEFAULT_TEMPERATURE);
    expect(parseTemperature('5')).toBe(DEFAULT_TEMPERATURE);
  });

  it('parseReasoning: only low|medium|high, case-insensitive', () => {
    expect(parseReasoning('Medium')).toBe('medium');
    expect(parseReasoning('off')).toBeUndefined();
    expect(parseReasoning('max')).toBeUndefined();
    expect(parseReasoning(undefined)).toBeUndefined();
  });

  it('parseImageEdge: default on blank/invalid, clamps to [512, 2576]', () => {
    expect(parseImageEdge(undefined)).toBe(DEFAULT_MAX_IMAGE_EDGE);
    expect(parseImageEdge('abc')).toBe(DEFAULT_MAX_IMAGE_EDGE);
    expect(parseImageEdge('100')).toBe(512);
    expect(parseImageEdge('4000')).toBe(2576);
    expect(parseImageEdge('2000.4')).toBe(2000);
  });
});
