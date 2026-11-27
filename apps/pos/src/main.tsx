import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { requestPersistentStorage } from './db/persist';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}

void requestPersistentStorage();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
