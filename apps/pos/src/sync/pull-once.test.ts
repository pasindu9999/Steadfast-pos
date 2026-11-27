import type { PullResponse } from '@pos/core';
import { describe, expect, it, vi } from 'vitest';

import { getSetting, getTerminalState, putSettings } from '../db/settings-repo';
import { DEVICE_TOKEN, fakeFetch } from '../test/api-fixtures';
import { productFixture, pullFixture } from '../test/fixtures';
import { createTestDb } from '../test/test-db';
import { type ApiClient, ApiRequestError, createApiClient } from './api-client';
import { pullOnce } from './pull-once';

async function enrolledDb() {
  const database = createTestDb();
  await putSettings(database, { apiUrl: 'https://api.test', deviceToken: DEVICE_TOKEN });
  return database;
}

function fakeClient(...responses: PullResponse[]) {
  const pull = vi.fn<ApiClient['pull']>();
  for (const response of responses) pull.mockResolvedValueOnce(response);
  const createClient = vi.fn((): ApiClient => ({ enrol: vi.fn(), pull }));
  return { pull, createClient };
}

describe('pullOnce', () => {
  it('makes the terminal ready with a first pull without a cursor', async () => {
    const database = await enrolledDb();
    const { pull, createClient } = fakeClient(
      pullFixture({ products: [productFixture({ id: 'p1' })] }),
    );

    const summary = await pullOnce({ database, createClient });

    expect(createClient).toHaveBeenCalledWith('https://api.test');
    expect(pull).toHaveBeenCalledWith(DEVICE_TOKEN, undefined);
    expect(summary).toMatchObject({ applied: true, products: 1 });
    expect(await getTerminalState(database)).toBe('ready');
  });

  it('sends the stored cursor on the next pull', async () => {
    const database = await enrolledDb();
    const { pull, createClient } = fakeClient(
      pullFixture({ nextCursor: 'cursor-1' }),
      pullFixture({ nextCursor: 'cursor-2' }),
    );

    await pullOnce({ database, createClient });
    await pullOnce({ database, createClient });

    expect(pull).toHaveBeenLastCalledWith(DEVICE_TOKEN, 'cursor-1');
    expect(await getSetting(database, 'pullCursor')).toBe('cursor-2');
  });

  it.each([
    ['the server refuses the token', 401, { error: { code: 'UNAUTHORIZED', message: '' } }],
    ['the response breaks the contract', 200, { products: [] }],
  ])('keeps the cursor and data when %s', async (_, status, body) => {
    const database = await enrolledDb();
    await putSettings(database, { pullCursor: 'cursor-1' });
    const createClient = (baseUrl: string) =>
      createApiClient({ baseUrl, fetchFn: fakeFetch(status, body) });

    await expect(pullOnce({ database, createClient })).rejects.toThrow(ApiRequestError);
    expect(await getSetting(database, 'pullCursor')).toBe('cursor-1');
    expect(await database.products.count()).toBe(0);
  });

  it('refuses on a device that is not enrolled, without a request', async () => {
    const { createClient } = fakeClient();

    await expect(pullOnce({ database: createTestDb(), createClient })).rejects.toThrow(
      /not enrolled/,
    );
    expect(createClient).not.toHaveBeenCalled();
  });
});
