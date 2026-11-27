import type { PullResponse } from '@pos/core';
import { describe, expect, it } from 'vitest';

import type { PosDatabase } from '../db/database';
import { getSetting } from '../db/settings-repo';
import type { OutboxRow, OutboxStatus, StockMovementRow, SyncedFlag } from '../db/types';
import {
  productFixture,
  pullFixture,
  staffFixture,
  storeFixture,
  variantFixture,
} from '../test/fixtures';
import { createTestDb } from '../test/test-db';
import { applyPull } from './apply-pull';

const NOW = new Date('2026-11-20T02:00:00.000Z');

const catalogue: Partial<PullResponse> = {
  products: [productFixture({ id: 'p1' })],
  variants: [variantFixture({ id: 'v1', sku: 'A' }), variantFixture({ id: 'v2', sku: 'B' })],
  staff: [staffFixture({ id: 's1' }), staffFixture({ id: 's2', name: 'Morgan' })],
  inventory: [
    { variantId: 'v1', onHand: 5 },
    { variantId: 'v2', onHand: -1 },
  ],
};

const first = (database: PosDatabase, fields: Partial<PullResponse> = catalogue) =>
  applyPull(database, pullFixture(fields), { requestCursor: undefined, now: NOW });

/** A pull that follows the first one. */
const next = (database: PosDatabase, fields: Partial<PullResponse>) =>
  applyPull(database, pullFixture({ nextCursor: 'cursor-2', ...fields }), {
    requestCursor: 'cursor-1',
    now: NOW,
  });

const event = (seq: number, status: OutboxStatus) =>
  ({ seq, eventId: `e${seq}`, status }) as OutboxRow;

const movement = (seq: number, synced: SyncedFlag = 0): StockMovementRow => ({
  id: `m${seq}`,
  variantId: 'v1',
  delta: -1,
  reason: 'sale',
  sourceType: 'sale',
  sourceId: `sale${seq}`,
  seq,
  synced,
  occurredAt: NOW.toISOString(),
});

async function addLocalSales(database: PosDatabase, statuses: OutboxStatus[]) {
  await database.outbox.bulkAdd(statuses.map((status, index) => event(index + 1, status)));
  await database.stockMovements.bulkAdd(statuses.map((_, index) => movement(index + 1)));
}

const statuses = async (database: PosDatabase) =>
  (await database.outbox.toArray()).map((row) => row.status);
const syncedFlags = async (database: PosDatabase) =>
  (await database.stockMovements.orderBy('id').toArray()).map((row) => row.synced);

describe('applyPull: first pull', () => {
  it('stores the store, catalogue, staff, stock and cursor', async () => {
    const database = createTestDb();

    const summary = await first(database);

    expect(summary).toEqual({ applied: true, products: 1, variants: 2, catalogueChanged: true });
    expect(await getSetting(database, 'store')).toEqual(storeFixture);
    expect(await getSetting(database, 'pullCursor')).toBe('cursor-1');
    expect(await getSetting(database, 'lastPulledAt')).toBe(NOW.toISOString());
    expect(await database.products.count()).toBe(1);
    expect(await database.variants.count()).toBe(2);
    expect(await database.staff.count()).toBe(2);
    expect(await database.inventory.toArray()).toEqual([
      { variantId: 'v1', serverOnHand: 5 },
      { variantId: 'v2', serverOnHand: -1 },
    ]);
  });

  it('replaces any catalogue rows already there', async () => {
    const database = createTestDb();
    await database.variants.add(variantFixture({ id: 'stale', sku: 'A' }));
    await database.inventory.add({ variantId: 'stale', serverOnHand: 9 });

    await first(database);

    expect(await database.variants.get('stale')).toBeUndefined();
    expect(await database.inventory.get('stale')).toBeUndefined();
  });
});

describe('applyPull: later pulls', () => {
  it('can receive the same rows twice (the 60 s overlap)', async () => {
    const database = createTestDb();
    await first(database);

    await next(database, catalogue);

    expect(await database.variants.count()).toBe(2);
    expect(await database.staff.count()).toBe(2);
    expect(await getSetting(database, 'pullCursor')).toBe('cursor-2');
  });

  it('updates the rows it receives and keeps the rest', async () => {
    const database = createTestDb();
    await first(database);

    const summary = await next(database, {
      variants: [variantFixture({ id: 'v1', sku: 'A', priceCents: 9500 })],
      inventory: [{ variantId: 'v1', onHand: 2 }],
      staff: catalogue.staff,
    });

    expect(summary).toMatchObject({ variants: 1, catalogueChanged: true });
    expect((await database.variants.get('v1'))?.priceCents).toBe(9500);
    expect(await database.variants.get('v2')).toBeDefined();
    expect(await database.inventory.get('v1')).toEqual({ variantId: 'v1', serverOnHand: 2 });
    expect((await database.inventory.get('v2'))?.serverOnHand).toBe(-1);
    expect(await database.products.count()).toBe(1);
  });

  it('reports an unchanged catalogue when only stock moved', async () => {
    const database = createTestDb();
    await first(database);

    const summary = await next(database, { inventory: [{ variantId: 'v1', onHand: 1 }] });

    expect(summary.catalogueChanged).toBe(false);
  });

  it('applies two variants that swapped SKUs', async () => {
    const database = createTestDb();
    await first(database);

    await next(database, {
      variants: [variantFixture({ id: 'v1', sku: 'B' }), variantFixture({ id: 'v2', sku: 'A' })],
    });

    expect((await database.variants.get('v1'))?.sku).toBe('B');
    expect((await database.variants.get('v2'))?.sku).toBe('A');
  });

  it('keeps archived rows, because old receipts refer to them', async () => {
    const database = createTestDb();
    await first(database);

    await next(database, { variants: [variantFixture({ id: 'v1', sku: 'A', isActive: false })] });

    expect((await database.variants.get('v1'))?.isActive).toBe(false);
  });

  it('replaces the staff list, which is always sent in full', async () => {
    const database = createTestDb();
    await first(database);

    await next(database, { staff: [staffFixture({ id: 's2', name: 'Morgan' })] });

    expect(await database.staff.toCollection().primaryKeys()).toEqual(['s2']);
  });
});

describe('applyPull: acknowledging sent events (ARCH §4.6)', () => {
  it('marks events and movements up to lastAppliedSeq as synced', async () => {
    const database = createTestDb();
    await first(database);
    await addLocalSales(database, ['pending', 'pending', 'pending']);

    await next(database, { lastAppliedSeq: 2 });

    expect(await statuses(database)).toEqual(['synced', 'synced', 'pending']);
    expect(await syncedFlags(database)).toEqual([1, 1, 0]);
  });

  it('keeps a rejected event marked as failed', async () => {
    const database = createTestDb();
    await first(database);
    await addLocalSales(database, ['failed', 'synced']);

    await next(database, { lastAppliedSeq: 2 });

    expect(await statuses(database)).toEqual(['failed', 'synced']);
    // The server's level is the truth for everything it has processed.
    expect(await syncedFlags(database)).toEqual([1, 1]);
  });

  it('leaves local sales alone when the server has applied none', async () => {
    const database = createTestDb();
    await first(database);
    await addLocalSales(database, ['pending']);

    await next(database, { inventory: [{ variantId: 'v1', onHand: 40 }] });

    expect(await statuses(database)).toEqual(['pending']);
    expect(await database.stockMovements.get('m1')).toEqual(movement(1));
  });
});

describe('applyPull: safety', () => {
  it('changes nothing if any step fails', async () => {
    const database = createTestDb();
    await addLocalSales(database, ['pending']);
    // Settings are written last.
    database.settings.hook('creating', () => {
      throw new Error('disk full');
    });

    await expect(first(database, { ...catalogue, lastAppliedSeq: 1 })).rejects.toThrow();

    expect(await database.products.count()).toBe(0);
    expect(await database.variants.count()).toBe(0);
    expect(await database.staff.count()).toBe(0);
    expect(await database.inventory.count()).toBe(0);
    expect(await database.settings.count()).toBe(0);
    expect(await statuses(database)).toEqual(['pending']);
    expect(await syncedFlags(database)).toEqual([0]);
  });

  it.each([
    ['a repeated first pull', undefined],
    ['an older cursor', 'cursor-0'],
  ])('ignores the response to %s', async (_, requestCursor) => {
    const database = createTestDb();
    await first(database);

    const summary = await applyPull(
      database,
      pullFixture({ nextCursor: 'cursor-late', inventory: [{ variantId: 'v1', onHand: 99 }] }),
      { requestCursor },
    );

    expect(summary).toEqual({ applied: false, products: 0, variants: 0, catalogueChanged: false });
    expect(await getSetting(database, 'pullCursor')).toBe('cursor-1');
    expect((await database.inventory.get('v1'))?.serverOnHand).toBe(5);
    expect(await database.variants.count()).toBe(2);
  });
});
