import React from 'react';
import ReactDOM from 'react-dom/client';
import { createContainer } from '@/bootstrap/container';
import { seedDevApiKey } from '@/bootstrap/seed-dev-api-key';
import { ServicesProvider } from '@/bootstrap/ServicesProvider';
import { App } from '@/ui/App';
import '@/ui/styles/index.css';

// Entry point: build the DI container, then render. All wiring lives in the
// container (bootstrap/).
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

const container = createContainer();

// Apply DB migrations before first render so persistence is ready when the
// first exchange completes (phase 4). No-op on the in-memory path. A migration
// failure must not block startup — the app still works minus persistence — so
// it's logged, not thrown.
const migrate = container.persistence
  .applyMigrations()
  .catch((err) => console.error('Failed to apply DB migrations', err));

// Seed the dev API key into the keychain BEFORE first render, so the HUD's
// initial "is a key configured?" check already sees it and no key-missing
// banner flashes. No-op in production builds (see seedDevApiKey). Startup must
// not block on either step, so we render once both settle (`finally`).
void Promise.allSettled([seedDevApiKey(container), migrate]).finally(() => {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ServicesProvider container={container}>
        <App />
      </ServicesProvider>
    </React.StrictMode>,
  );
});
