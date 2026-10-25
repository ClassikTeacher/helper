import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// Tauri expects a fixed port and does not want Vite obscuring Rust errors.
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), tsconfigPaths()],

  // Prevent Vite from clearing Rust errors in the Tauri console.
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      // Do not watch the Rust crate; the Tauri CLI handles it.
      ignored: ['**/src-tauri/**'],
    },
  },

  // Env vars prefixed with these are exposed to the client.
  envPrefix: ['VITE_', 'TAURI_'],

  // The dev-only OpenRouter key must never reach a shipped bundle. The only
  // code that reads it is gated on `import.meta.env.DEV` (container.ts,
  // seed-dev-api-key.ts); on top of that, a production build defines the
  // variable away to an empty string, so whatever `.env` holds on the build
  // machine cannot be inlined as a literal (2026-10 review §2.2). Dev keys
  // belong in `.env.development.local`, which `vite build` never loads.
  define:
    command === 'build' ? { 'import.meta.env.VITE_OPENROUTER_API_KEY': JSON.stringify('') } : {},

  build: {
    // Tauri uses a modern webview; target evergreen output.
    target: 'esnext',
    minify: 'esbuild',
    // No source maps in the shipped bundle: `frontendDist` is embedded into
    // the binary as-is, and maps would only add size and expose the source.
    sourcemap: false,
  },
}));
