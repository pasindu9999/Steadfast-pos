import {
  allocateProRata,
  calculateDiscountCents,
  DEFAULT_MANAGER_THRESHOLD_PERCENT,
  exceedsManagerThreshold,
  type Discount,
} from './discounts.js';
import {
  assertNonNegativeCents,
  cashRoundingAdjustment,
  multiplyCents,
  sumCents,
  type Cents,
} from './money.js';
import { calculateTax, type TaxSettings } from './tax.js';

export interface StoreConfig extends TaxSettings {
  storeId: string;
  /** Cash totals round to this many cents. 0 or 1 turns rounding off. */
  cashRoundingCents: number;
  /** Defaults to {@link DEFAULT_MANAGER_THRESHOLD_PERCENT}. */
  managerDiscountThresholdPercent?: number;
}

export type TenderMethod = 'cash' | 'card';

export interface CartLineInput {
  variantId: string;
  qty: number;
  unitPriceCents: Cents;
  /** Discount on the whole line, not per unit. */
  discount?: Discount | null;
}

export interface CalculatedLine {
  /** 1-based position in the cart. */
  lineNo: number;
  variantId: string;
  qty: number;
  unitPriceCents: Cents;
  /** qty × unit price */
  grossCents: Cents;
  ownDiscountCents: Cents;
  /** This line's share of the cart discount. */
  cartDiscountCents: Cents;
  /** Own plus allocated cart discount. */
  discountCents: Cents;
  /** Gross minus discounts. Contains tax only when prices include it. */
  netCents: Cents;
  taxCents: Cents;
  /** What the customer pays for this line, before cash rounding. */
  lineTotalCents: Cents;
  exceedsDiscountThreshold: boolean;
}

export interface CartTotals {
  lines: CalculatedLine[];
  /** Σ gross, before any discount. */
  subtotalCents: Cents;
  discountCents: Cents;
  /** The total after line discounts, which the cart discount applies to. */
  cartBaseCents: Cents;
  taxCents: Cents;
  /** Cash rounding, positive or negative. */
  roundingCents: Cents;
  /** The amount to charge. */
  totalCents: Cents;
  requiresManagerApproval: boolean;
}

/**
 * Prices a cart (ARCH §6.4): line gross, line discounts, cart discount allocation, tax per line,
 * then cash rounding on the total.
 */
export function calculateCart(
  lines: readonly CartLineInput[],
  cartDiscount: Discount | null,
  storeConfig: StoreConfig,
  tender: TenderMethod,
): CartTotals {
  const thresholdPercent =
    storeConfig.managerDiscountThresholdPercent ?? DEFAULT_MANAGER_THRESHOLD_PERCENT;

  const discounted = lines.map((line) => {
    if (!Number.isSafeInteger(line.qty) || line.qty <= 0) {
      throw new RangeError(`qty must be a positive integer, got ${line.qty}`);
    }
    assertNonNegativeCents(line.unitPriceCents, 'unitPriceCents');
    const grossCents = multiplyCents(line.unitPriceCents, line.qty);
    const discount = line.discount ?? null;
    const ownDiscountCents = calculateDiscountCents(discount, grossCents);
    return {
      line,
      discount,
      grossCents,
      ownDiscountCents,
      baseCents: grossCents - ownDiscountCents,
    };
  });

  const bases = discounted.map((entry) => entry.baseCents);
  const cartBaseCents = sumCents(bases);
  const shares = allocateProRata(calculateDiscountCents(cartDiscount, cartBaseCents), bases);

  const calculated = discounted.map((entry, index): CalculatedLine => {
    const cartDiscountCents = shares[index] ?? 0;
    const tax = calculateTax(entry.baseCents - cartDiscountCents, storeConfig);
    return {
      lineNo: index + 1,
      variantId: entry.line.variantId,
      qty: entry.line.qty,
      unitPriceCents: entry.line.unitPriceCents,
      grossCents: entry.grossCents,
      ownDiscountCents: entry.ownDiscountCents,
      cartDiscountCents,
      discountCents: entry.ownDiscountCents + cartDiscountCents,
      netCents: tax.netCents,
      taxCents: tax.taxCents,
      lineTotalCents: tax.payableCents,
      exceedsDiscountThreshold: exceedsManagerThreshold({
        grossCents: entry.grossCents,
        lineDiscount: entry.discount,
        cartDiscount,
        cartBaseCents,
        thresholdPercent,
      }),
    };
  });

  const payableCents = sumCents(calculated.map((line) => line.lineTotalCents));
  // Only cash is rounded (ARCH §6.4 rule 5). The increment is validated for card sales too.
  const cashAdjustmentCents = cashRoundingAdjustment(payableCents, storeConfig.cashRoundingCents);
  const roundingCents = tender === 'cash' ? cashAdjustmentCents : 0;

  return {
    lines: calculated,
    subtotalCents: sumCents(calculated.map((line) => line.grossCents)),
    discountCents: sumCents(calculated.map((line) => line.discountCents)),
    cartBaseCents,
    taxCents: sumCents(calculated.map((line) => line.taxCents)),
    roundingCents,
    totalCents: sumCents([payableCents, roundingCents]),
    requiresManagerApproval: calculated.some((line) => line.exceedsDiscountThreshold),
  };
}
