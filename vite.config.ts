import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

// Tauri expects a fixed port and does not want Vite obscuring Rust errors.
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
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

  build: {
    // Tauri uses a modern webview; target evergreen output.
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
});
