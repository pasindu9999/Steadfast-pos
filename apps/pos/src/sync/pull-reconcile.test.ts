/** A pull while sales are still unsynced must not count any of them twice (ARCH §4.6). */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosDatabase } from '../db/database';
import { getAvailable } from '../db/stock-repo';
import { LINEN_ID } from '../test/checkout-fixtures';
import { createFakeSyncServer, type FakeSyncServer } from '../test/fake-sync-server';
import {
  outboxStatuses,
  sell,
  syncDeps,
  terminalWithSales,
  unsyncedSeqs,
} from '../test/sync-fixtures';
import { pullOnce } from './pull-once';
import { pushPending } from './push-pending';

let server: FakeSyncServer;

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
beforeEach(() => {
  server = createFakeSyncServer();
  server.state.stock.set(LINEN_ID, 200);
  server.listen();
});
afterEach(() => server.close());
afterAll(() => vi.restoreAllMocks());

const available = (database: PosDatabase) => getAvailable(database, LINEN_ID);
const pull = (database: PosDatabase) => pullOnce(syncDeps(database));

describe('pull with unsynced sales', () => {
  it('adds them to the new server level', async () => {
    const database = await terminalWithSales(3);
    // Another terminal sold 10.
    server.state.stock.set(LINEN_ID, 190);

    await pull(database);

    expect(await available(database)).toBe(187);
    expect(await outboxStatuses(database)).toEqual(['pending', 'pending', 'pending']);
    expect(await unsyncedSeqs(database)).toEqual([1, 2, 3]);
  });

  it('counts a sale once when the server has it but the answer was lost', async () => {
    const database = await terminalWithSales(2);
    server.state.faults.push('drop_after_commit');
    await expect(pushPending(syncDeps(database))).rejects.toThrow();
    await sell(database);
    // The server has two sales; the terminal still thinks all three are waiting.
    expect(await available(database)).toBe(197);

    await pull(database);

    expect(await available(database)).toBe(197);
    expect(await outboxStatuses(database)).toEqual(['synced', 'synced', 'pending']);
    expect(await unsyncedSeqs(database)).toEqual([3]);

    await pushPending(syncDeps(database));

    expect(server.state.pushes.at(-1)).toEqual([3]);
    expect(server.state.applied).toHaveLength(3);
    expect(await available(database)).toBe(197);
  });

  it('keeps counting a sale made while the pull was in flight', async () => {
    const database = await terminalWithSales(1);
    await pushPending(syncDeps(database));
    server.state.onPull = () => sell(database);

    await pull(database);

    expect(await available(database)).toBe(198);
    expect(await outboxStatuses(database)).toEqual(['synced', 'pending']);
  });

  it('leaves an unsynced movement exactly as it was', async () => {
    const database = await terminalWithSales(1);
    const before = await database.stockMovements.toArray();

    await pull(database);

    expect(await database.stockMovements.toArray()).toEqual(before);
  });
});
