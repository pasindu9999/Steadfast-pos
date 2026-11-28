/**
 * Browser tests against the built app: service workers don't run on the Vite dev server. `pnpm e2e`
 * builds the app first.
 */
import { defineConfig, devices } from '@playwright/test';

import { APP_URL, UPDATE_APP_URL } from './support/urls.js';

const preview = (url: string, args = '') =>
  `pnpm --filter pos exec vite preview --port ${new URL(url).port} --strictPort ${args}`;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // The update tests change a file that one of the servers is serving.
  workers: 1,
  forbidOnly: !!process.env['CI'],
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: APP_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: preview(APP_URL), url: APP_URL, reuseExistingServer: false },
    {
      // A copy of the build, so a test can publish a "new version" of it.
      command: `node support/copy-dist.mjs && ${preview(UPDATE_APP_URL, '--outDir ../../e2e/.tmp/dist')}`,
      url: UPDATE_APP_URL,
      reuseExistingServer: false,
    },
  ],
});
