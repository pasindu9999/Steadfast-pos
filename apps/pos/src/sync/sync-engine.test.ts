/** The engine as the app runs it, with real timers, against the fake API. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosDatabase } from '../db/database';
import { getSetting } from '../db/settings-repo';
import { browserTargets } from '../test/browser-targets';
import { LINEN_ID } from '../test/checkout-fixtures';
import { createFakeSyncServer, type FakeSyncServer } from '../test/fake-sync-server';
import { outboxStatuses, sell, syncDeps, terminalWithSales, upTo } from '../test/sync-fixtures';
import { createMemoryChannelHub, type SyncChannel } from './channel';
import { createMemoryLockManager, createSyncLock, type LockManagerLike } from './lock';
import { createSyncEngine } from './sync-engine';

let server: FakeSyncServer;
let locks: LockManagerLike;
let channels: () => SyncChannel;
const stops: (() => void)[] = [];

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
beforeEach(() => {
  server = createFakeSyncServer();
  server.state.stock.set(LINEN_ID, 200);
  server.listen();
  locks = createMemoryLockManager();
  channels = createMemoryChannelHub();
});
afterEach(async () => {
  stops.splice(0).forEach((stop) => stop());
  // Lets a cycle that is still running finish before the server goes away.
  await createSyncLock(locks).run(() => Promise.resolve());
  server.close();
});
afterAll(() => vi.restoreAllMocks());

/** One browser tab: its own engine and events, sharing the database and the lock. */
function openTab(database: PosDatabase) {
  const targets = browserTargets();
  const engine = createSyncEngine({
    ...syncDeps(database),
    lock: createSyncLock(locks),
    createChannel: channels,
    targets: () => targets,
    checkStorage: () => Promise.resolve('persisted'),
  });
  const stop = engine.start();
  stops.push(stop);
  return { engine, window: targets.window, stop };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const allSent = (database: PosDatabase, count: number) =>
  vi.waitFor(
    async () => expect(await outboxStatuses(database)).toEqual(upTo(count).map(() => 'synced')),
    { timeout: 5_000 },
  );

describe('createSyncEngine', () => {
  it('does nothing until started', async () => {
    const database = await terminalWithSales(1);
    const engine = createSyncEngine({ ...syncDeps(database), lock: createSyncLock(locks) });

    engine.syncNow();
    await pause(50);

    expect(server.state.log).toEqual([]);
  });

  it('pushes, then pulls, at start-up and learns whether storage is persisted', async () => {
    const database = await terminalWithSales(1);

    const { engine } = openTab(database);

    await vi.waitFor(() =>
      expect(engine.status.getState()).toEqual({
        reachable: true,
        syncing: false,
        storage: 'persisted',
      }),
    );
    await vi.waitFor(() => expect(server.state.pulls).toBe(1));
    expect(server.state.log).toEqual(['health', 'push', 'pull']);
  });

  it('sends a sale shortly after it is committed', async () => {
    const database = await terminalWithSales(0);
    openTab(database);
    await vi.waitFor(() => expect(server.state.pulls).toBe(1));

    await sell(database);

    await allSent(database, 1);
    expect(server.state.pushes).toEqual([[1]]);
  });

  it('sends 120 sales made while offline as 3 batches, in order, once back online', async () => {
    server.state.healthy = false;
    const database = await terminalWithSales(0);
    const { engine, window } = openTab(database);
    await vi.waitFor(() => expect(engine.status.getState().reachable).toBe(false));
    await sell(database, 120);
    expect(server.state.pushes).toEqual([]);

    server.state.healthy = true;
    window.dispatchEvent(new Event('online'));

    await allSent(database, 120);
    expect(server.state.pushes.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(server.state.pushes.flat()).toEqual(upTo(120));
    expect(server.state.applied).toHaveLength(120);
  });

  it('lets only one of two tabs push at a time, so each event is sent once', async () => {
    const database = await terminalWithSales(60);
    server.state.onPush = () => pause(30).then(() => undefined);

    openTab(database);
    openTab(database);

    await allSent(database, 60);
    await vi.waitFor(() => expect(server.state.pulls).toBe(2));
    expect(server.state.maxInFlight).toBe(1);
    expect(server.state.pushes.flat()).toEqual(upTo(60));
  });

  it('tells the other tab what the connection is doing', async () => {
    server.state.healthy = false;
    const database = await terminalWithSales(0);
    const first = openTab(database);
    await vi.waitFor(() => expect(first.engine.status.getState().reachable).toBe(false));
    // The second tab's own checks hang, so what it shows can only come from the first.
    const silent: typeof fetch = () => new Promise<Response>(() => undefined);
    const second = createSyncEngine({
      ...syncDeps(database, silent),
      lock: createSyncLock(createMemoryLockManager()),
      createChannel: channels,
      targets: () => browserTargets(),
      checkStorage: () => Promise.resolve('persisted'),
    });

    stops.push(second.start());

    await vi.waitFor(() => expect(second.status.getState().reachable).toBe(false));
  });

  it('stops at a 401 and tries again only when asked', async () => {
    const database = await terminalWithSales(1);
    server.state.faults.push('unauthorized');
    const { engine, window } = openTab(database);
    await vi.waitFor(async () => expect(await getSetting(database, 'syncHalt')).toBeDefined());

    window.dispatchEvent(new Event('online'));
    await sell(database);
    await pause(700);
    expect(server.state.log).toEqual(['health', 'push']);

    engine.syncNow();

    await allSent(database, 2);
    await vi.waitFor(async () => expect(await getSetting(database, 'syncHalt')).toBeUndefined());
  });

  it('makes no further request once stopped', async () => {
    const database = await terminalWithSales(0);
    const { window, stop } = openTab(database);
    await vi.waitFor(() => expect(server.state.pulls).toBe(1));
    const before = server.state.log.length;

    stop();
    window.dispatchEvent(new Event('online'));
    await sell(database);
    await pause(700);

    expect(server.state.log).toHaveLength(before);
  });
});
