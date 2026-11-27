/** An amount of money in integer cents. */
export type Cents = number;

export function isCents(value: unknown): value is Cents {
  return Number.isSafeInteger(value);
}

export function assertCents(value: number, label = 'amount'): void {
  // Not isCents(): as a type guard it would narrow `value` to never here.
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer number of cents, got ${value}`);
  }
}

export function assertNonNegativeCents(value: number, label = 'amount'): void {
  assertCents(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must not be negative, got ${value}`);
  }
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    assertCents(value, 'term');
    total += value;
    assertCents(total, 'sum');
  }
  return total;
}

export function multiplyCents(unitCents: Cents, qty: number): Cents {
  assertCents(unitCents, 'unitCents');
  if (!Number.isSafeInteger(qty) || qty < 0) {
    throw new RangeError(`qty must be a non-negative integer, got ${qty}`);
  }
  const product = unitCents * qty;
  assertCents(product, 'product');
  // Adding 0 turns -0 into 0.
  return product + 0;
}

/**
 * `value × multiplier ÷ divisor`, rounded half-up (halves go away from zero).
 * BigInt keeps the intermediate product exact.
 */
export function mulDivRoundHalfUp(value: number, multiplier: number, divisor: number): number {
  assertCents(value, 'value');
  assertCents(multiplier, 'multiplier');
  if (!Number.isSafeInteger(divisor) || divisor <= 0) {
    throw new RangeError(`divisor must be a positive integer, got ${divisor}`);
  }
  const product = BigInt(value) * BigInt(multiplier);
  const magnitude = product < 0n ? -product : product;
  const bigDivisor = BigInt(divisor);
  const quotient = (magnitude * 2n + bigDivisor) / (bigDivisor * 2n);
  const result = Number(product < 0n ? -quotient : quotient);
  assertCents(result, 'result');
  return result;
}

/** Rounds to the nearest multiple of `incrementCents`, halves away from zero. */
export function roundToIncrement(cents: Cents, incrementCents: number): Cents {
  const steps = mulDivRoundHalfUp(cents, 1, incrementCents);
  return mulDivRoundHalfUp(steps, incrementCents, 1);
}

/** Australian cash rounding: 1–2c go down, 3–4c go up. */
export function roundCash5c(cents: Cents): Cents {
  return roundToIncrement(cents, 5);
}

/**
 * The ± adjustment that rounds a non-negative cash amount to the store's increment.
 * An increment of 0 or 1 turns rounding off.
 */
export function cashRoundingAdjustment(amountCents: Cents, incrementCents: number): Cents {
  assertNonNegativeCents(amountCents, 'amountCents');
  assertNonNegativeCents(incrementCents, 'cashRoundingCents');
  if (incrementCents <= 1) return 0;
  return roundToIncrement(amountCents, incrementCents) - amountCents;
}

/** Cash to hand back. Throws if less than the total was tendered. */
export function changeDueCents(tenderedCents: Cents, totalCents: Cents): Cents {
  assertNonNegativeCents(tenderedCents, 'tenderedCents');
  assertNonNegativeCents(totalCents, 'totalCents');
  const change = tenderedCents - totalCents;
  assertNonNegativeCents(change, 'change');
  return change;
}

/** `123456` → `$1,234.56`. Formats from integers, so no float is ever involved. */
export function formatAUD(cents: Cents): string {
  assertCents(cents);
  const absolute = Math.abs(cents);
  const remainder = absolute % 100;
  const dollars = String((absolute - remainder) / 100).replace(/\B(?=(\d{3})+$)/g, ',');
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${dollars}.${String(remainder).padStart(2, '0')}`;
}

// Optional `$`, then dollars (plain or with thousands commas) and at most two decimals.
const AMOUNT_PATTERN = /^\$?(?=\.?\d)(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{0,2}))?$/;

/**
 * `12.5` → `1250`. Reads a typed dollar amount from its digits, so no float is ever involved.
 * Returns `null` for anything else, including negative and out-of-range amounts.
 */
export function parseAUDToCents(text: string): Cents | null {
  const match = AMOUNT_PATTERN.exec(text.trim());
  if (match === null) return null;
  const [, dollars = '', decimals = ''] = match;
  const cents = Number(`${dollars.replaceAll(',', '')}${decimals.padEnd(2, '0')}`);
  return isCents(cents) ? cents : null;
}
