import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

import { pwaOptions } from './pwa.config.js';

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA(pwaOptions)],
  test: {
    // IndexedDB must exist before Dexie is imported.
    setupFiles: ['./src/test/setup.ts'],
  },
});
