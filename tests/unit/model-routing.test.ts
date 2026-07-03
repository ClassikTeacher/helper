import { describe, it, expect, afterEach, vi } from 'vitest';
import { envRoutingTable } from '@/bootstrap/model-routing';
import { DEFAULT_ROUTING_TABLE } from '@/core/application/services/model-router';

describe('envRoutingTable', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps each task to its VITE_DEFAULT_MODEL* env var', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/quick');
    vi.stubEnv('VITE_DEFAULT_MODEL_VISION', 'vendor/vision');
    vi.stubEnv('VITE_DEFAULT_MODEL_REASONING', 'vendor/reasoning');
    vi.stubEnv('VITE_DEFAULT_MODEL_CODING', 'vendor/coding');

    expect(envRoutingTable()).toEqual({
      'quick-answer': 'vendor/quick',
      vision: 'vendor/vision',
      reasoning: 'vendor/reasoning',
      coding: 'vendor/coding',
    });
  });

  it('falls back to the compiled-in default per task when a var is unset', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', '');
    vi.stubEnv('VITE_DEFAULT_MODEL_VISION', '');
    vi.stubEnv('VITE_DEFAULT_MODEL_REASONING', '');
    vi.stubEnv('VITE_DEFAULT_MODEL_CODING', '');

    expect(envRoutingTable()).toEqual(DEFAULT_ROUTING_TABLE);
  });

  it('only overrides the scenarios the env names, leaving others on the default', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', 'vendor/quick');
    vi.stubEnv('VITE_DEFAULT_MODEL_VISION', '');
    vi.stubEnv('VITE_DEFAULT_MODEL_REASONING', '');
    vi.stubEnv('VITE_DEFAULT_MODEL_CODING', '');

    const table = envRoutingTable();

    expect(table['quick-answer']).toBe('vendor/quick');
    expect(table.vision).toBe(DEFAULT_ROUTING_TABLE.vision);
  });

  it('trims surrounding whitespace from an env slug', () => {
    vi.stubEnv('VITE_DEFAULT_MODEL', '  vendor/quick  ');

    expect(envRoutingTable()['quick-answer']).toBe('vendor/quick');
  });
});
