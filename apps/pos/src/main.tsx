import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { requestPersistentStorage } from './db/persist';
import { appUpdates } from './pwa/updates';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

void requestPersistentStorage();

// Only a built app has a service worker. Started before enrolment, so the first visit already
// stores everything needed to open offline.
if (import.meta.env.PROD) appUpdates.start();

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
