import { hashPin, type PullStaff } from '@pos/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PosDatabase } from '../db/database';
import { getSetting } from '../db/settings-repo';
import { staffFixture } from '../test/fixtures';
import { createTestDb } from '../test/test-db';
import { listLoginStaff, MAX_PIN_ATTEMPTS, PIN_LOCK_MS, verifyStaffPin } from './staff-pin';

const NOW = Date.parse('2026-11-20T02:00:00.000Z');
const UNLOCKS_AT = new Date(NOW + PIN_LOCK_MS).toISOString();

let staff: PullStaff[];

beforeAll(async () => {
  // Few iterations keep the tests quick; the real count has its own test.
  const hash = (pin: string) => hashPin(pin, { iterations: 1000 });
  staff = [
    staffFixture({ id: 'casey', name: 'Casey', pinHash: await hash('1111') }),
    staffFixture({ id: 'morgan', name: 'Morgan', role: 'manager', pinHash: await hash('9999') }),
    staffFixture({ id: 'olive', name: 'Olive', role: 'owner', pinHash: await hash('2468') }),
    staffFixture({ id: 'gone', name: 'Alex', pinHash: await hash('3333'), isActive: false }),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function staffDb(): Promise<PosDatabase> {
  const database = createTestDb();
  await database.staff.bulkAdd(staff);
  return database;
}

const attempt = (
  database: PosDatabase,
  pin: string,
  { staffId = 'casey', at = NOW, minRole = undefined as PullStaff['role'] | undefined } = {},
) => verifyStaffPin(database, { staffId, pin, minRole, now: () => new Date(at) });

async function fail(database: PosDatabase, times: number, staffId = 'casey') {
  for (let i = 0; i < times; i += 1) await attempt(database, '0000', { staffId });
}

describe('verifyStaffPin', () => {
  it('accepts the right PIN and never hands out the hash', async () => {
    expect(await attempt(await staffDb(), '1111')).toEqual({
      status: 'ok',
      staff: { id: 'casey', name: 'Casey', role: 'cashier' },
    });
  });

  it('works without a network', async () => {
    const network = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', network);

    expect((await attempt(await staffDb(), '1111')).status).toBe('ok');
    expect(network).not.toHaveBeenCalled();
  });

  it('verifies a hash made the way the server makes it', async () => {
    const database = createTestDb();
    await database.staff.add(staffFixture({ id: 'casey', pinHash: await hashPin('1111') }));

    expect((await attempt(database, '1111')).status).toBe('ok');
    expect((await attempt(database, '1112')).status).toBe('wrong_pin');
  });

  it('counts down, then locks on the fifth wrong PIN for five minutes', async () => {
    expect(MAX_PIN_ATTEMPTS).toBe(5);
    expect(PIN_LOCK_MS).toBe(300_000);
    const database = await staffDb();

    for (const attemptsLeft of [4, 3, 2, 1]) {
      expect(await attempt(database, '0000')).toEqual({ status: 'wrong_pin', attemptsLeft });
    }
    expect(await attempt(database, '0000')).toEqual({ status: 'locked', lockedUntil: UNLOCKS_AT });
  });

  it('refuses even the right PIN while locked, without extending the lock', async () => {
    const database = await staffDb();
    await fail(database, 5);

    for (const at of [NOW, NOW + 60_000, NOW + PIN_LOCK_MS - 1]) {
      expect(await attempt(database, '1111', { at })).toEqual({
        status: 'locked',
        lockedUntil: UNLOCKS_AT,
      });
    }
  });

  it('allows five new attempts once the lock has passed', async () => {
    const database = await staffDb();
    await fail(database, 5);
    const later = NOW + PIN_LOCK_MS;

    expect(await attempt(database, '0000', { at: later })).toEqual({
      status: 'wrong_pin',
      attemptsLeft: 4,
    });
    expect((await attempt(database, '1111', { at: later })).status).toBe('ok');
  });

  it('forgets earlier failures after a success', async () => {
    const database = await staffDb();
    await fail(database, 4);

    expect((await attempt(database, '1111')).status).toBe('ok');

    expect(await attempt(database, '0000')).toEqual({ status: 'wrong_pin', attemptsLeft: 4 });
  });

  it('accepts the right PIN as the fifth attempt and leaves no lock behind', async () => {
    const database = await staffDb();
    await fail(database, 4);

    expect((await attempt(database, '1111')).status).toBe('ok');
    expect(await getSetting(database, 'pinAttempts')).toEqual({});
  });

  it('locks one person only', async () => {
    const database = await staffDb();
    await fail(database, 2, 'morgan');
    await fail(database, 5);

    expect(await attempt(database, '9999', { staffId: 'olive' })).toMatchObject({
      status: 'wrong_pin',
    });
    expect((await attempt(database, '9999', { staffId: 'morgan' })).status).toBe('ok');
    expect((await attempt(database, '1111')).status).toBe('locked');
  });

  it('stays locked after the app restarts', async () => {
    const first = await staffDb();
    await fail(first, 5);
    first.close();

    const second = new PosDatabase(first.name);

    expect((await attempt(second, '1111')).status).toBe('locked');
  });

  it('checks no more than five PINs when many arrive at once', async () => {
    const database = await staffDb();
    const derivations = vi.spyOn(crypto.subtle, 'deriveBits');

    const results = await Promise.all(Array.from({ length: 10 }, () => attempt(database, '0000')));

    expect(derivations).toHaveBeenCalledTimes(5);
    expect(results.filter((result) => result.status === 'wrong_pin')).toHaveLength(4);
    expect(results.filter((result) => result.status === 'locked')).toHaveLength(6);
  });

  it.each(['', '12', 'abcd', '123456789', ' 1111'])(
    'does not count %j, which can’t be a PIN',
    async (pin) => {
      const database = await staffDb();
      await fail(database, 1);

      expect(await attempt(database, pin)).toEqual({ status: 'wrong_pin', attemptsLeft: 4 });
      expect(await attempt(database, '0000')).toEqual({ status: 'wrong_pin', attemptsLeft: 3 });
    },
  );

  it.each([
    ['someone unknown', 'nobody', undefined],
    ['an inactive person', 'gone', undefined],
    ['a cashier asked for manager approval', 'casey', 'manager' as const],
    ['a manager asked for owner rights', 'morgan', 'owner' as const],
  ])('does not allow %s, and counts nothing', async (_, staffId, minRole) => {
    const database = await staffDb();
    const derivations = vi.spyOn(crypto.subtle, 'deriveBits');

    expect(await attempt(database, '1111', { staffId, minRole })).toEqual({
      status: 'not_allowed',
    });
    expect(derivations).not.toHaveBeenCalled();
    expect(await getSetting(database, 'pinAttempts')).toBeUndefined();
  });

  it.each([
    ['morgan', '9999'],
    ['olive', '2468'],
  ])('lets %s approve as a manager', async (staffId, pin) => {
    const result = await attempt(await staffDb(), pin, { staffId, minRole: 'manager' });

    expect(result.status).toBe('ok');
  });

  it('shares the failure count between login and manager approval', async () => {
    const database = await staffDb();
    await fail(database, 4, 'morgan');

    const result = await attempt(database, '0000', { staffId: 'morgan', minRole: 'manager' });

    expect(result.status).toBe('locked');
  });
});

describe('listLoginStaff', () => {
  it('lists active staff by name, without PIN hashes', async () => {
    expect(await listLoginStaff(await staffDb())).toEqual([
      { id: 'casey', name: 'Casey', role: 'cashier' },
      { id: 'morgan', name: 'Morgan', role: 'manager' },
      { id: 'olive', name: 'Olive', role: 'owner' },
    ]);
  });

  it('lists who can approve as a manager', async () => {
    const managers = await listLoginStaff(await staffDb(), { minRole: 'manager' });

    expect(managers.map((member) => member.id)).toEqual(['morgan', 'olive']);
  });

  it('is empty before the first pull', async () => {
    expect(await listLoginStaff(createTestDb())).toEqual([]);
  });
});
