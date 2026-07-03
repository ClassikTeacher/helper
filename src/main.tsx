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

// Seed the dev API key into the keychain BEFORE first render, so the HUD's
// initial "is a key configured?" check already sees it and no key-missing
// banner flashes. No-op in production builds (see seedDevApiKey). Seeding must
// not block startup, so we render regardless of its outcome (`finally`).
void seedDevApiKey(container).finally(() => {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ServicesProvider container={container}>
        <App />
      </ServicesProvider>
    </React.StrictMode>,
  );
});
