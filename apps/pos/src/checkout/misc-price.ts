import { type Cents, parseAUDToCents } from '@pos/core';

/** A guard against typing slips, such as a barcode typed as a price. */
export const MAX_MISC_PRICE_CENTS = 1_000_000;

export function parseMiscPrice(text: string): { cents: Cents } | { error: string } {
  const cents = parseAUDToCents(text);
  if (cents === null || cents === 0) return { error: 'Enter a price above $0.' };
  if (cents > MAX_MISC_PRICE_CENTS) return { error: 'Enter a price up to $10,000.' };
  return { cents };
}
