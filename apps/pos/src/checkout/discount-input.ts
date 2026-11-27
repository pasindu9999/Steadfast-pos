/** A typed discount, checked with the rules of `@pos/core` (ARCH §6.4). */
import {
  type Cents,
  type Discount,
  type DiscountError,
  formatAUD,
  getDiscountError,
  parseAUDToCents,
} from '@pos/core';

export type DiscountKind = Discount['type'];

export type ParsedDiscount = { discount: Discount | null } | { error: string };

const WHOLE_PERCENT = 'Enter a whole percentage from 0 to 100.';

const PERCENT_ERRORS: Record<DiscountError, string> = {
  NOT_INTEGER: WHOLE_PERCENT,
  NEGATIVE: 'A discount can’t be negative.',
  PERCENT_OVER_100: 'A discount can’t be more than 100%.',
};

function parsePercent(text: string): ParsedDiscount {
  const digits = text.trim().replace(/%$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(digits)) return { error: WHOLE_PERCENT };
  const discount: Discount = { type: 'percent', value: Number(digits) };
  const error = getDiscountError(discount);
  if (error !== null) return { error: PERCENT_ERRORS[error] };
  return { discount: discount.value === 0 ? null : discount };
}

/** 0 means no discount. A dollar amount may not be more than what it applies to. */
export function parseDiscount(
  kind: DiscountKind,
  text: string,
  baseCents: Cents,
  baseName: 'line total' | 'cart total',
): ParsedDiscount {
  if (kind === 'percent') return parsePercent(text);
  const value = parseAUDToCents(text);
  if (value === null) return { error: 'Enter a dollar amount, such as 5 or 5.50.' };
  if (value > baseCents) {
    return { error: `That is more than the ${baseName} of ${formatAUD(baseCents)}.` };
  }
  return { discount: value === 0 ? null : { type: 'fixed', value } };
}
