import { describe, expect, it } from 'vitest';

import { commitSale } from '../checkout/commit-sale';
import { cart, cartLine, CASHIER_ID, readyDb, TEE_ID } from '../test/checkout-fixtures';
import { staffFixture, storeFixture } from '../test/fixtures';
import { loadReceipt } from './load-receipt';

const CASH = { method: 'cash', tenderedCents: 20000 } as const;

async function sell(draft = cart()) {
  const database = await readyDb();
  await database.staff.add(staffFixture({ id: CASHIER_ID, name: 'Casey Cashier' }));
  const committed = await commitSale(draft, CASH, { database });
  return { database, committed };
}

describe('loadReceipt', () => {
  it('gathers the sale, its lines, payment, cashier and store', async () => {
    const { database, committed } = await sell();

    expect(await loadReceipt(database, committed.sale.id)).toEqual({
      sale: committed.sale,
      lines: committed.lines,
      payment: committed.payment,
      cashierName: 'Casey Cashier',
      store: storeFixture,
    });
  });

  it('keeps the lines in the order they were sold', async () => {
    const lines = Array.from({ length: 12 }, (_, index) =>
      cartLine({ variantId: TEE_ID, name: `Item ${index + 1}`, unitPriceCents: 100 }),
    );
    const { database, committed } = await sell(cart({ lines }));

    const receipt = await loadReceipt(database, committed.sale.id);

    expect(receipt?.lines.map((line) => line.lineNo)).toEqual(lines.map((_, index) => index + 1));
  });

  it('has no cashier name for someone this terminal no longer knows', async () => {
    const { database, committed } = await sell();
    await database.staff.clear();

    expect(await loadReceipt(database, committed.sale.id)).toMatchObject({ cashierName: null });
  });

  it('finds nothing for an unknown sale', async () => {
    const { database } = await sell();

    expect(await loadReceipt(database, 'no-such-sale')).toBeNull();
  });
});
