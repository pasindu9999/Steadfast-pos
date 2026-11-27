import { assertNonNegativeCents, mulDivRoundHalfUp, sumCents, type Cents } from './money.js';

export type Discount =
  /** Whole percent, 0–100. */
  { type: 'percent'; value: number } | { type: 'fixed'; value: Cents };

export type DiscountError = 'NOT_INTEGER' | 'NEGATIVE' | 'PERCENT_OVER_100';

/** Discounts strictly above this need a manager PIN. */
export const DEFAULT_MANAGER_THRESHOLD_PERCENT = 20;

export function getDiscountError(discount: Discount): DiscountError | null {
  if (!Number.isSafeInteger(discount.value)) return 'NOT_INTEGER';
  if (discount.value < 0) return 'NEGATIVE';
  if (discount.type === 'percent' && discount.value > 100) return 'PERCENT_OVER_100';
  return null;
}

function assertDiscount(discount: Discount): void {
  const error = getDiscountError(discount);
  if (error !== null) {
    throw new RangeError(`invalid ${discount.type} discount ${discount.value}: ${error}`);
  }
}

/** The cents taken off `baseCents`. A fixed amount is capped at the base. */
export function calculateDiscountCents(discount: Discount | null, baseCents: Cents): Cents {
  assertNonNegativeCents(baseCents, 'baseCents');
  if (discount === null) return 0;
  assertDiscount(discount);

  switch (discount.type) {
    case 'percent':
      return mulDivRoundHalfUp(baseCents, discount.value, 100);
    case 'fixed':
      return Math.min(discount.value, baseCents);
  }
}

/**
 * Splits `totalCents` across `weightsCents` pro-rata with the largest-remainder method
 * (ARCH §6.4 rule 2). The shares sum exactly to the total and no share exceeds its weight.
 * Equal remainders favour the earlier line, so every device gets the same result.
 */
export function allocateProRata(totalCents: Cents, weightsCents: readonly Cents[]): Cents[] {
  assertNonNegativeCents(totalCents, 'totalCents');
  for (const weight of weightsCents) assertNonNegativeCents(weight, 'weight');
  const weightSum = sumCents(weightsCents);
  if (totalCents > weightSum) {
    throw new RangeError(`cannot allocate ${totalCents} across weights summing to ${weightSum}`);
  }
  if (totalCents === 0) return weightsCents.map(() => 0);

  const total = BigInt(totalCents);
  const divisor = BigInt(weightSum);
  const parts = weightsCents.map((weight, index) => {
    const product = total * BigInt(weight);
    return { index, share: Number(product / divisor), remainder: product % divisor };
  });

  const leftover = totalCents - sumCents(parts.map((part) => part.share));
  const byRemainder = [...parts].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (const part of byRemainder.slice(0, leftover)) part.share += 1;

  return parts.map((part) => part.share);
}

/** A discount as an exact fraction of the amount it applies to. */
function discountRate(discount: Discount | null, baseCents: Cents): [bigint, bigint] {
  if (discount === null) return [0n, 1n];
  assertDiscount(discount);
  if (discount.type === 'percent') return [BigInt(discount.value), 100n];
  if (baseCents === 0) return [0n, 1n];
  return [BigInt(Math.min(discount.value, baseCents)), BigInt(baseCents)];
}

/**
 * Whether one line's combined discount (its own plus its share of the cart discount) is strictly
 * above the threshold. Compares exact ratios, so cent rounding never triggers a manager PIN.
 */
export function exceedsManagerThreshold(args: {
  grossCents: Cents;
  lineDiscount: Discount | null;
  cartDiscount: Discount | null;
  /** The cart total after line discounts, which the cart discount applies to. */
  cartBaseCents: Cents;
  thresholdPercent: number;
}): boolean {
  const { grossCents, lineDiscount, cartDiscount, cartBaseCents, thresholdPercent } = args;
  assertNonNegativeCents(grossCents, 'grossCents');
  assertNonNegativeCents(cartBaseCents, 'cartBaseCents');
  if (!Number.isInteger(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) {
    throw new RangeError(`thresholdPercent must be an integer 0–100, got ${thresholdPercent}`);
  }
  const [lineOff, lineWhole] = discountRate(lineDiscount, grossCents);
  const [cartOff, cartWhole] = discountRate(cartDiscount, cartBaseCents);
  if (grossCents === 0) return false;

  // Fraction paid = (1 − line rate) × (1 − cart rate).
  const whole = lineWhole * cartWhole;
  const paid = (lineWhole - lineOff) * (cartWhole - cartOff);
  return (whole - paid) * 100n > BigInt(thresholdPercent) * whole;
}
