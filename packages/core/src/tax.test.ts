import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assertTaxRateBp, BP_SCALE, calculateLinesTax, calculateTax } from './tax.js';

const gstInclusive = { taxRateBp: 1000, pricesIncludeTax: true };
const gstExclusive = { taxRateBp: 1000, pricesIncludeTax: false };

describe('assertTaxRateBp', () => {
  it.each([0, 1, 1000, BP_SCALE])('accepts %d', (rate) => {
    expect(() => assertTaxRateBp(rate)).not.toThrow();
  });

  it.each([-1, BP_SCALE + 1, 10.5, Number.NaN])('rejects %s', (rate) => {
    expect(() => assertTaxRateBp(rate)).toThrow(RangeError);
  });
});

describe('calculateTax, GST inclusive', () => {
  it('finds $2.27 GST inside $25.00', () => {
    expect(calculateTax(2500, gstInclusive)).toEqual({
      netCents: 2500,
      taxCents: 227,
      payableCents: 2500,
    });
  });

  it.each([
    [0, 0],
    [1, 0],
    [5, 0],
    [6, 1],
    [11, 1],
  ])('%dc contains %dc GST', (net, tax) => {
    expect(calculateTax(net, gstInclusive).taxCents).toBe(tax);
  });

  it('rounds an exact half cent up', () => {
    // 1c at 100% inclusive is 0.5c of tax.
    expect(calculateTax(1, { taxRateBp: BP_SCALE, pricesIncludeTax: true }).taxCents).toBe(1);
  });
});

describe('calculateTax, tax exclusive', () => {
  it('adds $2.50 to $25.00', () => {
    expect(calculateTax(2500, gstExclusive)).toEqual({
      netCents: 2500,
      taxCents: 250,
      payableCents: 2750,
    });
  });

  it.each([
    [0, 0],
    [1, 0],
    [4, 0],
    [5, 1],
    [15, 2],
  ])('adds the right tax to %dc: %dc', (net, tax) => {
    const result = calculateTax(net, gstExclusive);
    expect(result.taxCents).toBe(tax);
    expect(result.payableCents).toBe(net + tax);
  });
});

describe('calculateTax, edge cases', () => {
  it('charges nothing at a zero rate in both modes', () => {
    for (const pricesIncludeTax of [true, false]) {
      expect(calculateTax(2500, { taxRateBp: 0, pricesIncludeTax })).toEqual({
        netCents: 2500,
        taxCents: 0,
        payableCents: 2500,
      });
    }
  });

  it('stays exact for large amounts', () => {
    expect(calculateTax(1_100_000_000_000, gstInclusive).taxCents).toBe(100_000_000_000);
  });

  it.each([-1, 1.5, Number.NaN])('throws for net %s', (net) => {
    expect(() => calculateTax(net, gstInclusive)).toThrow(RangeError);
  });

  it('throws for an invalid rate', () => {
    expect(() => calculateTax(100, { taxRateBp: -1, pricesIncludeTax: true })).toThrow(RangeError);
  });

  it('throws when the exclusive payable amount leaves the safe range', () => {
    expect(() => calculateTax(Number.MAX_SAFE_INTEGER, gstExclusive)).toThrow(RangeError);
  });
});

describe('calculateLinesTax', () => {
  it('returns zero for an empty cart', () => {
    expect(calculateLinesTax([], gstInclusive)).toEqual({ lines: [], taxCents: 0 });
  });

  it('rounds each line, then sums', () => {
    // Three 5c lines: 1 + 1 + 1. Rounding the 15c aggregate would give 2.
    const result = calculateLinesTax([5, 5, 5], gstExclusive);
    expect(result.lines.map((line) => line.taxCents)).toEqual([1, 1, 1]);
    expect(result.taxCents).toBe(3);
  });

  it('always has a cart tax equal to the sum of the line taxes', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { maxLength: 30 }),
        fc.integer({ min: 0, max: BP_SCALE }),
        fc.boolean(),
        (nets, taxRateBp, pricesIncludeTax) => {
          const result = calculateLinesTax(nets, { taxRateBp, pricesIncludeTax });
          expect(result.taxCents).toBe(result.lines.reduce((sum, line) => sum + line.taxCents, 0));
          for (const [index, line] of result.lines.entries()) {
            expect(line.netCents).toBe(nets[index]);
            expect(line.taxCents).toBeGreaterThanOrEqual(0);
            if (pricesIncludeTax) {
              expect(line.taxCents).toBeLessThanOrEqual(line.netCents);
              expect(line.payableCents).toBe(line.netCents);
            } else {
              expect(line.payableCents).toBe(line.netCents + line.taxCents);
            }
          }
        },
      ),
    );
  });
});
