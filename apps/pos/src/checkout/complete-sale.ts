/** Takes payment for the cart: one `commitSale`, however often it is asked (ARCH §4.2). */
import type { PullStore } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { unapprovedDiscountLines } from './approvals';
import type { createCartStore } from './cart-store';
import { CheckoutError } from './checkout-error';
import { checkoutMessage } from './checkout-message';
import { commitSale } from './commit-sale';
import { priceCart } from './price-cart';
import type { TenderInput } from './sale-draft';

export interface SaleDeps {
  cart: ReturnType<typeof createCartStore>;
  database: PosDatabase;
  store: PullStore;
  staffId: string | null;
  now: () => Date;
}

export type SaleResult =
  | { status: 'saved'; saleId: string }
  | { status: 'failed'; message: string }
  /** Already being saved, or nothing to save. */
  | { status: 'ignored' };

export async function completeSale(
  { cart, database, store, staffId, now }: SaleDeps,
  tender: TenderInput,
): Promise<SaleResult> {
  const current = cart.getState();
  if (current.lines.length === 0) return { status: 'ignored' };
  // The till asks before opening payment; this is the last check.
  if (unapprovedDiscountLines(current, priceCart(current, store, tender.method)).length > 0) {
    return { status: 'failed', message: 'A discount needs manager approval before payment.' };
  }
  if (!current.beginCommit()) return { status: 'ignored' };

  try {
    const { lines, cartDiscount } = current;
    const { sale } = await commitSale({ lines, cartDiscount, staffId }, tender, {
      database,
      now,
    });
    cart.getState().endCommit(true);
    return { status: 'saved', saleId: sale.id };
  } catch (error) {
    cart.getState().endCommit(false);
    // The error's kind only: its message could repeat what was typed.
    const kind = error instanceof CheckoutError ? error.code : (error as Error | undefined)?.name;
    console.error('Sale was not saved', kind);
    return { status: 'failed', message: checkoutMessage(error) };
  }
}
