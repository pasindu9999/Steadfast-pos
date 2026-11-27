/**
 * When the till needs a manager (ARCH §9). Pure: asking for the PIN is the screen's job.
 * Whether a discount is over the limit is decided by `@pos/core`; this only remembers what a
 * manager has already seen.
 */
import type { CartTotals, Cents, Discount } from '@pos/core';

import { type ApprovedDiscount, type Cart, findLine } from './cart';

/** A line may hold this many units without a manager. */
export const QTY_APPROVAL_THRESHOLD = 10;

/** Whether raising a line to `qty` needs a manager. Lowering it never does. */
export function needsQuantityApproval(cart: Cart, key: string, qty: number): boolean {
  return (
    qty > QTY_APPROVAL_THRESHOLD &&
    qty > (findLine(cart, key)?.qty ?? 0) &&
    qty > (cart.approvals.qty[key] ?? 0)
  );
}

/** Whether an approval still stands for the discount now on a line or the cart. */
function covers(
  current: Discount | null | undefined,
  baseCents: Cents,
  approved: ApprovedDiscount | null | undefined,
): boolean {
  if (!current || current.value === 0) return true;
  if (!approved || approved.discount.type !== current.type) return false;
  if (current.value > approved.discount.value) return false;
  // The same dollars off a smaller amount is a bigger discount.
  return current.type === 'percent' || baseCents >= approved.baseCents;
}

/** The lines whose discount is over the limit and has not been approved as it now stands. */
export function unapprovedDiscountLines(cart: Cart, totals: CartTotals): string[] {
  const { approvals, cartDiscount } = cart;
  return cart.lines.flatMap((line, index) => {
    // `calculateCart` returns the lines in the order it was given them.
    const priced = totals.lines[index]!;
    if (!priced.exceedsDiscountThreshold) return [];
    const approved =
      covers(line.discount, priced.grossCents, approvals.lineDiscounts[line.key]) &&
      covers(cartDiscount, totals.cartBaseCents, approvals.cartDiscount);
    return approved ? [] : [line.key];
  });
}

/** Records a manager's approval of the discounts on the given lines. */
export function grantDiscounts(
  cart: Cart,
  totals: CartTotals,
  keys: readonly string[] = unapprovedDiscountLines(cart, totals),
): Cart {
  if (keys.length === 0) return cart;
  const lineDiscounts = { ...cart.approvals.lineDiscounts };
  cart.lines.forEach((line, index) => {
    if (!keys.includes(line.key) || !line.discount) return;
    const baseCents = totals.lines[index]!.grossCents;
    lineDiscounts[line.key] = { discount: line.discount, baseCents };
  });
  const cartDiscount = cart.cartDiscount
    ? { discount: cart.cartDiscount, baseCents: totals.cartBaseCents }
    : cart.approvals.cartDiscount;
  return { ...cart, approvals: { ...cart.approvals, lineDiscounts, cartDiscount } };
}
