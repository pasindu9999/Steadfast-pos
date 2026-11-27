import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosDatabase } from '../db/database';
import { getSetting, saveSyncHalt } from '../db/settings-repo';
import { LINEN_ID } from '../test/checkout-fixtures';
import { createFakeSyncServer, type FakeSyncServer } from '../test/fake-sync-server';
import { outboxStatuses, syncDeps, terminalWithSales } from '../test/sync-fixtures';
import { createTestDb } from '../test/test-db';
import { createMemoryLockManager, createSyncLock } from './lock';
import { createSyncStatusStore } from './status-store';
import { type CycleDeps, runSyncCycle } from './sync-cycle';

const NOW = new Date('2026-11-20T02:00:00.000Z');

let server: FakeSyncServer;

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  server = createFakeSyncServer();
  server.state.stock.set(LINEN_ID, 200);
  server.listen();
});
afterEach(() => server.close());
afterAll(() => vi.restoreAllMocks());

function cycleDeps(database: PosDatabase): CycleDeps {
  return {
    ...syncDeps(database),
    lock: createSyncLock(createMemoryLockManager()),
    status: createSyncStatusStore(),
    now: () => NOW,
  };
}

const auto = { pull: false, manual: false };
const full = { pull: true, manual: false };
const manual = { pull: true, manual: true };

const savedHalt = (database: PosDatabase) => getSetting(database, 'syncHalt');

describe('runSyncCycle', () => {
  it('checks health, pushes, then pulls', async () => {
    const database = await terminalWithSales(2);
    const deps = cycleDeps(database);

    await expect(runSyncCycle(deps, full)).resolves.toEqual({ status: 'ok', pulled: true });

    expect(server.state.log).toEqual(['health', 'push', 'pull']);
    expect(await outboxStatuses(database)).toEqual(['synced', 'synced']);
    expect(await getSetting(database, 'lastSyncedAt')).toBe(NOW.toISOString());
    expect(deps.status.getState()).toMatchObject({ reachable: true, syncing: false });
  });

  it('pulls only when asked', async () => {
    const deps = cycleDeps(await terminalWithSales(1));

    await expect(runSyncCycle(deps, auto)).resolves.toEqual({ status: 'ok', pulled: false });

    expect(server.state.log).toEqual(['health', 'push']);
  });

  it('shows that it is syncing while a push is in flight', async () => {
    const deps = cycleDeps(await terminalWithSales(1));
    const seen: boolean[] = [];
    server.state.onPush = () => {
      seen.push(deps.status.getState().syncing);
    };

    await runSyncCycle(deps, auto);

    expect(seen).toEqual([true]);
    expect(deps.status.getState().syncing).toBe(false);
  });

  it('sends nothing while the health check fails', async () => {
    const database = await terminalWithSales(1);
    const deps = cycleDeps(database);
    server.state.healthy = false;

    await expect(runSyncCycle(deps, full)).resolves.toEqual({ status: 'retry' });

    expect(server.state.log).toEqual(['health']);
    expect(deps.status.getState()).toMatchObject({ reachable: false, syncing: false });
    expect(await getSetting(database, 'lastSyncedAt')).toBeUndefined();
  });

  it.each(['server_error', 'drop_before_commit'] as const)(
    'does not pull after a push that failed (%s)',
    async (fault) => {
      const deps = cycleDeps(await terminalWithSales(1));
      server.state.faults.push(fault);

      await expect(runSyncCycle(deps, full)).resolves.toEqual({ status: 'retry' });

      expect(server.state.log).toEqual(['health', 'push']);
      expect(deps.status.getState()).toMatchObject({ reachable: false, syncing: false });
    },
  );

  it('retries a failed pull, without halting', async () => {
    const database = await terminalWithSales(0);
    server.state.pullFaults.push('server_error');

    await expect(runSyncCycle(cycleDeps(database), full)).resolves.toEqual({ status: 'retry' });

    expect(await savedHalt(database)).toBeUndefined();
  });

  it.each([
    ['push', () => server.state.faults.push('unauthorized'), 1],
    ['pull', () => server.state.pullFaults.push('unauthorized'), 0],
  ])('saves the halt when the %s is refused with 401', async (_, refuse, sales) => {
    const database = await terminalWithSales(sales);
    refuse();

    await expect(runSyncCycle(cycleDeps(database), full)).resolves.toEqual({
      status: 'halted',
      reason: 'UNAUTHORIZED',
    });

    expect(await savedHalt(database)).toEqual({ reason: 'UNAUTHORIZED', at: NOW.toISOString() });
  });

  it('does not pull after SEQ_REUSED, so the pull cannot mark the sales synced', async () => {
    const database = await terminalWithSales(2);
    server.state.lastAppliedSeq = 5;

    await expect(runSyncCycle(cycleDeps(database), full)).resolves.toEqual({
      status: 'halted',
      reason: 'SEQ_REUSED',
    });

    expect(server.state.log).toEqual(['health', 'push']);
    expect(await outboxStatuses(database)).toEqual(['pending', 'pending']);
    expect(await savedHalt(database)).toMatchObject({ reason: 'SEQ_REUSED' });
  });

  it('makes no request while a saved halt stands', async () => {
    const database = await terminalWithSales(1);
    await saveSyncHalt(database, 'UNAUTHORIZED', NOW);
    const deps = cycleDeps(database);

    await expect(runSyncCycle(deps, full)).resolves.toEqual({
      status: 'halted',
      reason: 'UNAUTHORIZED',
    });

    expect(server.state.log).toEqual([]);
    expect(deps.status.getState().syncing).toBe(false);
  });

  it('tries once when asked by hand, and clears the halt when that works', async () => {
    const database = await terminalWithSales(1);
    await saveSyncHalt(database, 'UNAUTHORIZED', NOW);

    await expect(runSyncCycle(cycleDeps(database), manual)).resolves.toMatchObject({
      status: 'ok',
    });

    expect(await savedHalt(database)).toBeUndefined();
    expect(await outboxStatuses(database)).toEqual(['synced']);
  });

  it.each([
    ['is offline', () => (server.state.healthy = false)],
    ['gets a server error', () => server.state.faults.push('server_error')],
    ['is refused again', () => server.state.faults.push('unauthorized')],
  ])('keeps the halt when a try by hand %s', async (_, fail) => {
    const database = await terminalWithSales(1);
    await saveSyncHalt(database, 'UNAUTHORIZED', NOW);
    fail();

    await runSyncCycle(cycleDeps(database), manual);

    expect(await savedHalt(database)).toMatchObject({ reason: 'UNAUTHORIZED' });
  });

  it('skips a terminal that is not enrolled', async () => {
    await expect(runSyncCycle(cycleDeps(createTestDb()), full)).resolves.toEqual({
      status: 'skipped',
    });

    expect(server.state.log).toEqual([]);
  });

  it('waits for the sync lock before making any request', async () => {
    const deps = cycleDeps(await terminalWithSales(1));
    let release!: () => void;
    const held = deps.lock.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const cycle = runSyncCycle(deps, full);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.state.log).toEqual([]);

    release();
    await Promise.all([held, cycle]);
    expect(server.state.log).toEqual(['health', 'push', 'pull']);
  });
});
