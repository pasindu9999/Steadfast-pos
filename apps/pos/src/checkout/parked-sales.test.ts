import { describe, expect, it } from 'vitest';

import { PosDatabase } from '../db/database';
import { LINEN_ID } from '../test/checkout-fixtures';
import { createTestDb } from '../test/test-db';
import type { Cart } from './cart';
import { listParkedSales, parkSale, takeParkedSale } from './parked-sales';

const held: Cart = {
  lines: [
    {
      key: LINEN_ID,
      variantId: LINEN_ID,
      sku: 'LIN-BLK-M',
      name: 'Linen Shirt — Black / M',
      qty: 12,
      unitPriceCents: 8900,
      discount: { type: 'percent', value: 25 },
    },
  ],
  cartDiscount: { type: 'fixed', value: 500 },
  approvals: {
    qty: { [LINEN_ID]: 12 },
    lineDiscounts: {
      [LINEN_ID]: { discount: { type: 'percent', value: 25 }, baseCents: 106800 },
    },
    cartDiscount: null,
  },
  scanHistory: [LINEN_ID],
};

const first = { id: 'a', parkedAt: '2026-11-27T00:00:00.000Z', staffName: 'Casey Cashier' };
const second = { id: 'b', parkedAt: '2026-11-27T00:05:00.000Z', staffName: null };

describe('parked sales', () => {
  it('is empty to begin with', async () => {
    expect(await listParkedSales(createTestDb())).toEqual([]);
  });

  it('keeps the whole cart, oldest first', async () => {
    const database = createTestDb();

    await parkSale(database, held, first);
    await parkSale(database, held, second);

    expect(await listParkedSales(database)).toEqual([
      { ...first, cart: held },
      { ...second, cart: held },
    ]);
  });

  it('stores only the cart, whatever else is passed with it', async () => {
    const database = createTestDb();
    const store = { ...held, committing: true, replace: () => undefined };

    await parkSale(database, store, first);

    expect((await listParkedSales(database))[0]?.cart).toEqual(held);
  });

  it('survives closing the app', async () => {
    const database = createTestDb();
    await parkSale(database, held, first);
    database.close();

    const reopened = new PosDatabase(database.name);

    expect(await listParkedSales(reopened)).toHaveLength(1);
  });

  it('loses none when two are parked at once', async () => {
    const database = createTestDb();

    await Promise.all([parkSale(database, held, first), parkSale(database, held, second)]);

    expect(await listParkedSales(database)).toHaveLength(2);
  });

  it('gives a sale out only once', async () => {
    const database = createTestDb();
    await parkSale(database, held, first);
    await parkSale(database, held, second);

    const taken = await Promise.all([takeParkedSale(database, 'a'), takeParkedSale(database, 'a')]);

    expect(taken.map((sale) => sale?.id)).toEqual(['a', undefined]);
    expect((await listParkedSales(database)).map((sale) => sale.id)).toEqual(['b']);
  });

  it('sells nothing and counts nothing by being parked', async () => {
    const database = createTestDb();

    await parkSale(database, held, first);

    expect(await database.sales.count()).toBe(0);
    expect(await database.stockMovements.count()).toBe(0);
    expect(await database.outbox.count()).toBe(0);
  });
});
