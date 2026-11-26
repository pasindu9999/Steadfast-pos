import { assertNonNegativeCents, mulDivRoundHalfUp, sumCents, type Cents } from './money.js';

/** Basis points in 100 %. */
export const BP_SCALE = 10_000;

export interface TaxSettings {
  /** 1000 = 10.00 % */
  taxRateBp: number;
  pricesIncludeTax: boolean;
}

export interface TaxBreakdown {
  /** The amount tax was calculated on: contains tax in inclusive mode, excludes it otherwise. */
  netCents: Cents;
  taxCents: Cents;
  /** What the customer pays for `netCents`. */
  payableCents: Cents;
}

export function assertTaxRateBp(rateBp: number): void {
  if (!Number.isSafeInteger(rateBp) || rateBp < 0 || rateBp > BP_SCALE) {
    throw new RangeError(`taxRateBp must be an integer from 0 to ${BP_SCALE}, got ${rateBp}`);
  }
}

/** ARCH §6.4 rule 4. */
export function calculateTax(netCents: Cents, settings: TaxSettings): TaxBreakdown {
  const { taxRateBp, pricesIncludeTax } = settings;
  assertNonNegativeCents(netCents, 'netCents');
  assertTaxRateBp(taxRateBp);

  const divisor = pricesIncludeTax ? BP_SCALE + taxRateBp : BP_SCALE;
  const taxCents = mulDivRoundHalfUp(netCents, taxRateBp, divisor);
  const payableCents = pricesIncludeTax ? netCents : sumCents([netCents, taxCents]);
  return { netCents, taxCents, payableCents };
}

/** Tax is rounded per line and the cart tax is the sum of the line taxes. */
export function calculateLinesTax(
  netsCents: readonly Cents[],
  settings: TaxSettings,
): { lines: TaxBreakdown[]; taxCents: Cents } {
  const lines = netsCents.map((netCents) => calculateTax(netCents, settings));
  return { lines, taxCents: sumCents(lines.map((line) => line.taxCents)) };
}
