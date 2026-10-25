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

// Before the first render: seed the dev API key into the keychain (so the
// HUD's initial "is a key configured?" check already sees it — a no-op in
// production, see seedDevApiKey) and load the user's settings (F2), so the
// hotkeys are registered once, with the right bindings. Neither may block
// startup: a failed settings load falls back to the defaults.
void Promise.allSettled([seedDevApiKey(container), container.useCases.manageSettings.load()])
  .then(([, settings]) => {
    if (settings.status === 'rejected') {
      console.error('Failed to load settings — using the defaults', settings.reason);
    }
  })
  .finally(() => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <ServicesProvider container={container}>
          <App />
        </ServicesProvider>
      </React.StrictMode>,
    );
  });
