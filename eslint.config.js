// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * ESLint flat config. Kept intentionally minimal (KISS) — its main job is
 * the dependency-direction lint-barrier promised in architecture.md §8:
 * `ui/*` is presentation-only and must never import `infrastructure/*` or
 * `@tauri-apps/*` directly; it may only reach logic through
 * `ui/hooks/useServices()`.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'dist-ssr/**', 'src-tauri/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // TypeScript itself is the source of truth for undefined symbols/
      // ambient globals (DOM lib, etc.) — ESLint's no-undef doesn't see
      // TS lib types and produces false positives. typescript-eslint's own
      // docs recommend disabling it in TS codebases.
      'no-undef': 'off',
      // Existing convention in fake/mock adapters: a leading underscore
      // marks a parameter as intentionally unused (interface conformance).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // architecture.md §8: presentation components/hooks reach the
    // application layer exclusively through `useServices()`; they must
    // never see infrastructure adapters or the Tauri API directly.
    files: ['src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/infrastructure/*', '@/infrastructure', '**/infrastructure/*', '**/infrastructure/**'],
              message:
                'ui/* must not import infrastructure/* directly — go through use-cases via useServices() (architecture.md §8).',
            },
            {
              group: ['@tauri-apps/*'],
              message:
                'ui/* must not import @tauri-apps/* directly — go through use-cases via useServices() (architecture.md §8).',
            },
          ],
        },
      ],
    },
  },
);
