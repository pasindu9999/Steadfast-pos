/** What the cart hands to the checkout. Nothing here is priced yet. */
import type { Cents, Discount } from '@pos/core';

export interface CartLineDraft {
  variantId: string;
  // Snapshots taken when the item was added, so the customer pays the price they saw.
  sku: string;
  name: string;
  qty: number;
  unitPriceCents: Cents;
  /** Discount on the whole line, not per unit. */
  discount?: Discount | null;
}

export interface SaleDraft {
  lines: readonly CartLineDraft[];
  cartDiscount: Discount | null;
  staffId: string | null;
}

export type TenderInput =
  | { method: 'cash'; tenderedCents: Cents }
  /** Entered after the EFTPOS terminal approves. Never card data (ARCH §11). */
  | { method: 'card'; cardReference?: string | null; cardLast4?: string | null };
