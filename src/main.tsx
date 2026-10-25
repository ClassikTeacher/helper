import React from 'react';
import ReactDOM from 'react-dom/client';
import { createContainer } from '@/bootstrap/container';
import { installLogForwarding } from '@/bootstrap/install-log-forwarding';
import { isTauriWindow } from '@/bootstrap/platform';
import { seedDevApiKey } from '@/bootstrap/seed-dev-api-key';
import { ServicesProvider } from '@/bootstrap/ServicesProvider';
import { App } from '@/ui/App';
import '@/ui/styles/index.css';

// Entry point: build the DI container, then render. All wiring lives in the
// container (bootstrap/).
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// Webview console errors/warnings go to the native log file too (only inside
// Tauri — the plugin's IPC does not exist in a plain browser).
if (isTauriWindow()) installLogForwarding();

const container = createContainer();

// Seed the dev API key into the keychain BEFORE first render, so the HUD's
// initial "is a key configured?" check already sees it and no key-missing
// banner flashes. No-op in production builds (see seedDevApiKey). Startup must
// not block on it, so we render once it settles (`finally`).
void seedDevApiKey(container).finally(() => {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ServicesProvider container={container}>
        <App />
      </ServicesProvider>
    </React.StrictMode>,
  );
});
