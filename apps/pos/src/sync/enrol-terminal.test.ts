import type { EnrolResponse } from '@pos/core';
import { describe, expect, it, vi } from 'vitest';

import { getSetting, getTerminalState, putSettings } from '../db/settings-repo';
import { DEVICE_TOKEN, enrolFixture, fakeFetch, TERMINAL_ID } from '../test/api-fixtures';
import { createTestDb } from '../test/test-db';
import { type ApiClient, ApiRequestError, createApiClient } from './api-client';
import { enrolTerminal, EnrolmentError } from './enrol-terminal';

const input = { apiUrl: 'https://api.test/v1/', enrolmentCode: '  DEMO-CODE-T1  ' };

function setUp(response: EnrolResponse = enrolFixture) {
  const database = createTestDb();
  const enrol = vi.fn<ApiClient['enrol']>(() => Promise.resolve(response));
  const createClient = vi.fn((): ApiClient => ({
    enrol,
    pull: vi.fn(),
    push: vi.fn(),
    health: vi.fn(),
  }));
  return { database, enrol, createClient };
}

describe('enrolTerminal', () => {
  it('stores the terminal identity, token and server address', async () => {
    const { database, enrol, createClient } = setUp();

    await enrolTerminal({ database, createClient }, input);

    expect(createClient).toHaveBeenCalledWith('https://api.test');
    expect(enrol).toHaveBeenCalledWith('DEMO-CODE-T1');
    expect(await getSetting(database, 'apiUrl')).toBe('https://api.test');
    expect(await getSetting(database, 'deviceToken')).toBe(DEVICE_TOKEN);
    expect(await getSetting(database, 'terminalId')).toBe(TERMINAL_ID);
    expect(await getSetting(database, 'terminalCode')).toBe('T1');
    expect(await getTerminalState(database)).toBe('needs_download');
  });

  it('starts every counter at zero on a new terminal', async () => {
    const deps = setUp();

    await enrolTerminal(deps, input);

    expect(await getSetting(deps.database, 'receiptSeq')).toBe(0);
    expect(await getSetting(deps.database, 'returnSeq')).toBe(0);
    expect(await getSetting(deps.database, 'outboxSeq')).toBe(0);
  });

  it('resumes the counters from the server high-water marks (ARCH §4.3)', async () => {
    const deps = setUp({ ...enrolFixture, lastAppliedSeq: 41, receiptSeq: 123, returnSeq: 17 });

    await enrolTerminal(deps, input);

    expect(await getSetting(deps.database, 'outboxSeq')).toBe(41);
    expect(await getSetting(deps.database, 'receiptSeq')).toBe(123);
    expect(await getSetting(deps.database, 'returnSeq')).toBe(17);
  });

  it.each([
    ['INVALID_URL', { ...input, apiUrl: 'http://api.test' }],
    ['INVALID_CODE', { ...input, enrolmentCode: 'short' }],
    ['INVALID_CODE', { ...input, enrolmentCode: '        ' }],
  ])('refuses with %s before any request', async (code, bad) => {
    const deps = setUp();

    await expect(enrolTerminal(deps, bad)).rejects.toMatchObject({ code });
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(await deps.database.settings.count()).toBe(0);
  });

  it('refuses an enrolled device without spending a code (re-enrolment is not built)', async () => {
    const deps = setUp();
    await putSettings(deps.database, { deviceToken: 'old-token', outboxSeq: 7 });

    await expect(enrolTerminal(deps, input)).rejects.toThrow(EnrolmentError);
    await expect(enrolTerminal(deps, input)).rejects.toMatchObject({ code: 'ALREADY_ENROLLED' });
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(await getSetting(deps.database, 'deviceToken')).toBe('old-token');
    expect(await getSetting(deps.database, 'outboxSeq')).toBe(7);
  });

  it.each([
    [
      'the server refuses the code',
      401,
      { error: { code: 'INVALID_ENROLMENT_CODE', message: '' } },
    ],
    ['the response breaks the contract', 200, { ...enrolFixture, deviceToken: 'short' }],
  ])('stores nothing when %s', async (_, status, body) => {
    const database = createTestDb();
    const createClient = (baseUrl: string) =>
      createApiClient({ baseUrl, fetchFn: fakeFetch(status, body) });

    await expect(enrolTerminal({ database, createClient }, input)).rejects.toThrow(ApiRequestError);
    expect(await database.settings.count()).toBe(0);
  });

  it('lets only one of two simultaneous enrolments win', async () => {
    const database = createTestDb();
    let issued = 0;
    const createClient = (): ApiClient => ({
      enrol: () => {
        issued += 1;
        return Promise.resolve({ ...enrolFixture, deviceToken: `${issued}`.padEnd(43, 't') });
      },
      pull: vi.fn(),
      push: vi.fn(),
      health: vi.fn(),
    });

    const results = await Promise.allSettled([
      enrolTerminal({ database, createClient }, input),
      enrolTerminal({ database, createClient }, input),
    ]);

    const failed = results.filter((result) => result.status === 'rejected');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toMatchObject({ code: 'ALREADY_ENROLLED' });
    expect(await getSetting(database, 'deviceToken')).toMatch(/^[12]t+$/);
  });
});
