import React from 'react';
import ReactDOM from 'react-dom/client';
import { ServicesProvider } from '@/bootstrap/ServicesProvider';
import { App } from '@/ui/App';
import '@/ui/styles/index.css';

// Entry point: render only. All wiring lives in the DI container (bootstrap/).
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ServicesProvider>
      <App />
    </ServicesProvider>
  </React.StrictMode>,
);
