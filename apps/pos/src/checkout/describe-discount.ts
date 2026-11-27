import { type CalculatedLine, type Discount, formatAUD } from '@pos/core';

/** `25%` or `$5.00`. */
export function discountAmount(discount: Discount): string {
  return discount.type === 'percent' ? `${discount.value}%` : formatAUD(discount.value);
}

/** Where a line's discount comes from: its own, a share of the cart's, or both. */
export function discountSources(
  own: Discount | null | undefined,
  { cartDiscountCents }: Pick<CalculatedLine, 'cartDiscountCents'>,
): string {
  const line = own ? `${discountAmount(own)} off this line` : null;
  if (cartDiscountCents === 0) return line ?? '';
  if (line === null) return 'from the cart discount';
  return `${line}, plus ${formatAUD(cartDiscountCents)} from the cart discount`;
}
