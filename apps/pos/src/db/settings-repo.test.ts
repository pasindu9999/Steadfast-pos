import { describe, expect, it } from 'vitest';

import { storeFixture } from '../test/fixtures';
import { createTestDb } from '../test/test-db';
import { getSetting, getTerminalState, putSettings } from './settings-repo';

describe('settings', () => {
  it('returns undefined for a setting that was never stored', async () => {
    expect(await getSetting(createTestDb(), 'deviceToken')).toBeUndefined();
  });

  it('stores several settings and reads each one back', async () => {
    const database = createTestDb();

    await putSettings(database, { receiptSeq: 0, apiUrl: 'https://api.test', store: storeFixture });

    expect(await getSetting(database, 'receiptSeq')).toBe(0);
    expect(await getSetting(database, 'apiUrl')).toBe('https://api.test');
    expect(await getSetting(database, 'store')).toEqual(storeFixture);
  });

  it('overwrites one setting and leaves the others', async () => {
    const database = createTestDb();
    await putSettings(database, { receiptSeq: 4, outboxSeq: 9 });

    await putSettings(database, { receiptSeq: 5 });

    expect(await getSetting(database, 'receiptSeq')).toBe(5);
    expect(await getSetting(database, 'outboxSeq')).toBe(9);
  });

  it('skips values that are undefined', async () => {
    const database = createTestDb();
    await putSettings(database, { pullCursor: 'abc' });

    await putSettings(database, { pullCursor: undefined });

    expect(await getSetting(database, 'pullCursor')).toBe('abc');
  });
});

describe('getTerminalState', () => {
  it('is not_enrolled on an empty device', async () => {
    expect(await getTerminalState(createTestDb())).toBe('not_enrolled');
  });

  it('needs a download after enrolment until the first pull is stored', async () => {
    const database = createTestDb();

    await putSettings(database, { deviceToken: 'token' });

    expect(await getTerminalState(database)).toBe('needs_download');
  });

  it('is ready once the store and a pull cursor are stored', async () => {
    const database = createTestDb();

    await putSettings(database, { deviceToken: 'token', store: storeFixture, pullCursor: 'c1' });

    expect(await getTerminalState(database)).toBe('ready');
  });
});
