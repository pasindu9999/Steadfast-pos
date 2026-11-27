import { liveQuery } from 'dexie';
import { describe, expect, it, vi } from 'vitest';

import { applyPull } from '../sync/apply-pull';
import { pullFixture } from '../test/fixtures';
import { createTestDb } from '../test/test-db';
import type { PosDatabase } from './database';
import { getAvailable, getAvailableMany, projectAvailable } from './stock-repo';
import type { StockMovementRow, SyncedFlag } from './types';

let movements = 0;

function movement(
  variantId: string,
  delta: number,
  fields: { seq?: number; synced?: SyncedFlag } = {},
): StockMovementRow {
  movements += 1;
  return {
    id: `m${movements}`,
    variantId,
    delta,
    reason: delta < 0 ? 'sale' : 'return',
    sourceType: delta < 0 ? 'sale' : 'return',
    sourceId: `source-${movements}`,
    seq: 1,
    synced: 0,
    occurredAt: '2026-11-20T02:00:00.000Z',
    ...fields,
  };
}

/** A terminal that has pulled once and holds `onHand` of variant `v1`. */
async function pulledDb(onHand: number): Promise<PosDatabase> {
  const database = createTestDb();
  await applyPull(database, pullFixture({ inventory: [{ variantId: 'v1', onHand }] }), {
    requestCursor: undefined,
  });
  return database;
}

const pullAgain = (database: PosDatabase, onHand: number, lastAppliedSeq: number) =>
  applyPull(
    database,
    pullFixture({
      inventory: [{ variantId: 'v1', onHand }],
      nextCursor: 'cursor-2',
      lastAppliedSeq,
    }),
    { requestCursor: 'cursor-1' },
  );

describe('projectAvailable', () => {
  it('is the server level when nothing is waiting', () => {
    expect(projectAvailable(7, [])).toBe(7);
  });

  it('adds only the unsynced deltas', () => {
    const local = [movement('v1', -2), movement('v1', 1), movement('v1', -50, { synced: 1 })];

    expect(projectAvailable(5, local)).toBe(4);
  });

  it('can go below zero (ARCH §5)', () => {
    expect(projectAvailable(0, [movement('v1', -3)])).toBe(-3);
    expect(projectAvailable(-2, [movement('v1', -1)])).toBe(-3);
  });
});

describe('getAvailable', () => {
  it('is zero for a variant with no stock row and no movements', async () => {
    expect(await getAvailable(createTestDb(), 'v1')).toBe(0);
  });

  it('counts local movements of a variant the server has no level for', async () => {
    const database = createTestDb();
    await database.stockMovements.add(movement('new', -1));

    expect(await getAvailable(database, 'new')).toBe(-1);
  });

  it('adds this variant’s unsynced movements to the server level', async () => {
    const database = await pulledDb(10);
    await database.stockMovements.bulkAdd([
      movement('v1', -2),
      movement('v1', -3),
      movement('v1', -4, { synced: 1 }),
      movement('v2', -9),
    ]);

    expect(await getAvailable(database, 'v1')).toBe(5);
    expect(await getAvailable(database, 'v2')).toBe(-9);
  });
});

describe('getAvailableMany', () => {
  it('answers for every variant asked about, once', async () => {
    const database = await pulledDb(4);
    await database.stockMovements.bulkAdd([movement('v1', -1), movement('v2', -2)]);

    const available = await getAvailableMany(database, ['v1', 'v2', 'unknown', 'v1']);

    expect(Object.fromEntries(available)).toEqual({ v1: 3, v2: -2, unknown: 0 });
  });

  it('accepts an empty list', async () => {
    expect(await getAvailableMany(createTestDb(), [])).toEqual(new Map());
  });
});

describe('the projection across pulls (ARCH §4.6)', () => {
  it('takes the new server level and keeps sales the server has not applied', async () => {
    const database = await pulledDb(10);
    await database.stockMovements.add(movement('v1', -2, { seq: 1 }));

    // A delivery arrived; our sale has not been sent yet.
    await pullAgain(database, 30, 0);

    expect(await getAvailable(database, 'v1')).toBe(28);
    expect(await database.stockMovements.count()).toBe(1);
  });

  it('counts a sale the server has applied only once, even if the reply was lost', async () => {
    const database = await pulledDb(1);
    await database.stockMovements.add(movement('v1', -1, { seq: 1 }));
    expect(await getAvailable(database, 'v1')).toBe(0);

    await pullAgain(database, 0, 1);

    expect(await getAvailable(database, 'v1')).toBe(0);
  });

  it('keeps counting only the sales after lastAppliedSeq', async () => {
    const database = await pulledDb(10);
    await database.stockMovements.bulkAdd([
      movement('v1', -1, { seq: 1 }),
      movement('v1', -2, { seq: 2 }),
    ]);

    await pullAgain(database, 9, 1);

    expect(await getAvailable(database, 'v1')).toBe(7);
  });

  it('never reads half of a pull', async () => {
    const database = await pulledDb(1);
    await database.stockMovements.add(movement('v1', -1, { seq: 1 }));

    const [before, , after] = await Promise.all([
      getAvailable(database, 'v1'),
      pullAgain(database, 0, 1),
      getAvailable(database, 'v1'),
    ]);

    // 1 − 1 before the pull and 0 − 0 after it: a mixed read would give 1 or −1.
    expect([before, after]).toEqual([0, 0]);
  });
});

describe('getAvailable under liveQuery', () => {
  it('re-runs after a local movement and after a pull', async () => {
    const database = await pulledDb(3);
    const seen: number[] = [];
    const subscription = liveQuery(() => getAvailable(database, 'v1')).subscribe((value) =>
      seen.push(value),
    );
    await vi.waitFor(() => expect(seen).toEqual([3]));

    await database.stockMovements.add(movement('v1', -1));
    await vi.waitFor(() => expect(seen.at(-1)).toBe(2));

    await pullAgain(database, 8, 0);
    await vi.waitFor(() => expect(seen.at(-1)).toBe(7));
    subscription.unsubscribe();
  });
});
