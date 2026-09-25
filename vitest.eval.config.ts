import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Prompt eval (R13): real model calls, node environment, hours-long timeout.
// Separate from `pnpm test` on purpose — it costs money and needs a key.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['eval/**/*.eval.ts'],
    testTimeout: 6 * 60 * 60 * 1000,
  },
});
