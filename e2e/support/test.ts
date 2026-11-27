import { test as base } from '@playwright/test';

import { type StubApi, startStubApi } from './stub-api.js';

export const test = base.extend<object, { api: StubApi }>({
  api: [
    // Playwright reads the names of the fixtures a fixture needs from this pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const api = await startStubApi();
      await use(api);
      await api.close();
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
