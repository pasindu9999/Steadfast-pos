import { describe, expect, it, vi } from 'vitest';

import { CASHIER_ID, LINEN_ID, readyDb } from '../test/checkout-fixtures';
import { storeFixture } from '../test/fixtures';
import { EMPTY_CART, setLineDiscount } from './cart';
import { createCartStore } from './cart-store';
import { completeSale, type SaleDeps } from './complete-sale';
import type { TenderInput } from './sale-draft';

const CASH: TenderInput = { method: 'cash', tenderedCents: 10000 };

const oneShirt = {
  ...EMPTY_CART,
  lines: [
    {
      key: LINEN_ID,
      variantId: LINEN_ID,
      sku: 'LIN-BLK-M',
      name: 'Linen Shirt — Black / M',
      qty: 1,
      unitPriceCents: 8900,
    },
  ],
};

async function setUp() {
  const database = await readyDb();
  const cart = createCartStore();
  cart.getState().replace(oneShirt);
  const deps: SaleDeps = {
    cart,
    database,
    store: storeFixture,
    staffId: CASHIER_ID,
    now: () => new Date('2026-11-27T01:00:00Z'),
  };
  return { database, cart, deps };
}

describe('completeSale', () => {
  it('saves the sale, then empties the cart', async () => {
    const { database, cart, deps } = await setUp();

    const result = await completeSale(deps, CASH);

    const [sale] = await database.sales.toArray();
    expect(result).toEqual({ status: 'saved', saleId: sale?.id });
    expect(sale).toMatchObject({
      staffId: CASHIER_ID,
      totalCents: 8900,
      occurredAt: '2026-11-27T01:00:00.000Z',
    });
    expect(cart.getState().lines).toEqual([]);
    expect(cart.getState().committing).toBe(false);
  });

  it('saves one sale however often it is asked while saving', async () => {
    const { database, deps } = await setUp();

    const results = await Promise.all([
      completeSale(deps, CASH),
      completeSale(deps, CASH),
      completeSale(deps, { method: 'card' }),
    ]);

    expect(results.map((result) => result.status)).toEqual(['saved', 'ignored', 'ignored']);
    expect(await database.sales.count()).toBe(1);
    expect(await database.outbox.count()).toBe(1);
  });

  it('does nothing with an empty cart', async () => {
    const { database, cart, deps } = await setUp();
    cart.getState().clear();

    expect(await completeSale(deps, CASH)).toEqual({ status: 'ignored' });
    expect(await database.sales.count()).toBe(0);
  });

  it('holds the cart still while saving', async () => {
    const { database, cart, deps } = await setUp();

    const saving = completeSale(deps, CASH);
    expect(cart.getState().committing).toBe(true);
    cart.getState().replace(EMPTY_CART);
    cart.getState().clear();
    expect(cart.getState().lines).toHaveLength(1);
    await saving;

    expect(await database.saleLines.count()).toBe(1);
  });

  it('keeps the cart and can be retried when storage fails', async () => {
    const { database, cart, deps } = await setUp();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fail = () => {
      throw new Error('disk trouble');
    };
    database.sales.hook('creating', fail);

    const failed = await completeSale(deps, CASH);

    expect(failed).toMatchObject({ status: 'failed' });
    expect(cart.getState().lines).toHaveLength(1);
    expect(cart.getState().committing).toBe(false);
    expect(await database.outbox.count()).toBe(0);
    // Logs say what failed, never what was being sold or paid.
    expect(JSON.stringify(log.mock.calls)).not.toContain('Linen');

    database.sales.hook('creating').unsubscribe(fail);
    expect(await completeSale(deps, CASH)).toMatchObject({ status: 'saved' });
    log.mockRestore();
  });

  it('words a refusal from the checkout', async () => {
    const { cart, deps } = await setUp();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await completeSale(deps, { method: 'cash', tenderedCents: 100 });

    expect(result).toEqual({
      status: 'failed',
      message: 'The cash received is less than the total.',
    });
    expect(cart.getState().lines).toHaveLength(1);
    log.mockRestore();
  });

  it('will not sell with a discount that no manager has approved', async () => {
    const { database, cart, deps } = await setUp();
    cart
      .getState()
      .replace(setLineDiscount(cart.getState(), LINEN_ID, { type: 'percent', value: 50 }));

    const result = await completeSale(deps, CASH);

    expect(result).toMatchObject({ status: 'failed', message: /manager approval/ });
    expect(await database.sales.count()).toBe(0);
    expect(cart.getState().committing).toBe(false);
  });
});
