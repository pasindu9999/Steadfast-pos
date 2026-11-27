/** Returns and voids made offline reach the server after their sale, and count once (ARCH §4.4). */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosDatabase } from '../db/database';
import { getAvailable } from '../db/stock-repo';
import { commitReturn } from '../returns/commit-return';
import { commitVoid } from '../returns/commit-void';
import { LINEN_ID } from '../test/checkout-fixtures';
import { createFakeSyncServer, type FakeSyncServer } from '../test/fake-sync-server';
import { staffFixture } from '../test/fixtures';
import { MANAGER } from '../test/shop';
import { outboxStatuses, syncDeps, terminalWithSales, unsyncedSeqs } from '../test/sync-fixtures';
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

async function returnTheShirt(database: PosDatabase, restock = true) {
  const sale = (await database.sales.toCollection().first())!;
  return commitReturn(
    {
      ref: { kind: 'local', saleId: sale.id },
      selections: [{ lineNo: 1, qty: 1, restock }],
      reason: 'Wrong size',
      method: 'cash',
      cardReference: null,
      staffId: null,
      approval: null,
    },
    { database },
  );
}

describe('pushPending: a return', () => {
  it('sends it after its sale, in seq order, and counts its restock once', async () => {
    const database = await terminalWithSales(1);
    await returnTheShirt(database);
    expect(await getAvailable(database, LINEN_ID)).toBe(200);

    await expect(pushPending(syncDeps(database))).resolves.toEqual({
      status: 'drained',
      sent: 2,
      failed: 0,
    });

    expect(server.state.pushes).toEqual([[1, 2]]);
    expect(server.state.applied.map((event) => event.type)).toEqual([
      'SALE_COMPLETED',
      'RETURN_COMPLETED',
    ]);
    expect(await outboxStatuses(database)).toEqual(['synced', 'synced']);
    expect(await unsyncedSeqs(database)).toEqual([]);
    expect(server.state.stock.get(LINEN_ID)).toBe(200);
    expect(await getAvailable(database, LINEN_ID)).toBe(200);
  });

  it('sends a return made after its sale had already gone', async () => {
    const database = await terminalWithSales(1);
    await pushPending(syncDeps(database));
    await returnTheShirt(database, false);

    await pushPending(syncDeps(database));

    expect(server.state.pushes).toEqual([[1], [2]]);
    // Damaged: the shirt does not come back into stock.
    expect(await getAvailable(database, LINEN_ID)).toBe(199);
  });

  it('sends a void after its sale, and counts the stock put back once', async () => {
    const database = await terminalWithSales(1);
    await database.staff.add(staffFixture({ ...MANAGER }));
    const sale = (await database.sales.toCollection().first())!;
    await commitVoid({ saleId: sale.id, reason: '', approval: MANAGER }, { database });
    expect(await getAvailable(database, LINEN_ID)).toBe(200);

    await pushPending(syncDeps(database));

    expect(server.state.applied.map((event) => event.type)).toEqual([
      'SALE_COMPLETED',
      'SALE_VOIDED',
    ]);
    expect(server.state.pushes).toEqual([[1, 2]]);
    expect(await outboxStatuses(database)).toEqual(['synced', 'synced']);
    expect(await getAvailable(database, LINEN_ID)).toBe(200);
  });

  it('marks a parked return as sent', async () => {
    const database = await terminalWithSales(1);
    await returnTheShirt(database);
    server.state.parks.add(2);

    await pushPending(syncDeps(database));

    expect(await outboxStatuses(database)).toEqual(['synced', 'synced']);
  });
});
