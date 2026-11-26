import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  allocateProRata,
  calculateDiscountCents,
  DEFAULT_MANAGER_THRESHOLD_PERCENT,
  exceedsManagerThreshold,
  getDiscountError,
  type Discount,
} from './discounts.js';

const percent = (value: number): Discount => ({ type: 'percent', value });
const fixed = (value: number): Discount => ({ type: 'fixed', value });
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe('getDiscountError', () => {
  it.each([percent(0), percent(100), fixed(0), fixed(1_000_000)])('accepts %o', (discount) => {
    expect(getDiscountError(discount)).toBeNull();
  });

  it.each([
    [percent(-1), 'NEGATIVE'],
    [percent(101), 'PERCENT_OVER_100'],
    [percent(12.5), 'NOT_INTEGER'],
    [percent(Number.NaN), 'NOT_INTEGER'],
    [fixed(-1), 'NEGATIVE'],
    [fixed(1.5), 'NOT_INTEGER'],
  ])('reports %o as %s', (discount, error) => {
    expect(getDiscountError(discount)).toBe(error);
  });
});

describe('calculateDiscountCents', () => {
  it('is zero without a discount', () => {
    expect(calculateDiscountCents(null, 5000)).toBe(0);
  });

  it.each([
    [0, 5000, 0],
    [10, 9990, 999],
    [15, 11_491, 1724],
    [50, 1, 1],
    [49, 1, 0],
    [100, 5000, 5000],
    [10, 0, 0],
  ])('takes %d%% of %dc as %dc', (value, base, expected) => {
    expect(calculateDiscountCents(percent(value), base)).toBe(expected);
  });

  it('takes a fixed amount', () => {
    expect(calculateDiscountCents(fixed(500), 5000)).toBe(500);
  });

  it('caps a fixed amount at the base', () => {
    expect(calculateDiscountCents(fixed(5001), 5000)).toBe(5000);
    expect(calculateDiscountCents(fixed(500), 0)).toBe(0);
  });

  it.each([percent(-1), percent(101), percent(12.5), fixed(-1), fixed(0.5)])(
    'throws for %o',
    (discount) => {
      expect(() => calculateDiscountCents(discount, 5000)).toThrow(RangeError);
    },
  );

  it('throws for a negative base', () => {
    expect(() => calculateDiscountCents(null, -1)).toThrow(RangeError);
  });
});

describe('allocateProRata', () => {
  it.each([
    [100, [100, 100, 100], [34, 33, 33]],
    [2, [5, 5, 5], [1, 1, 0]],
    [1724, [8991, 2500], [1349, 375]],
    [1, [0, 5], [0, 1]],
    [0, [10, 20], [0, 0]],
    [0, [0, 0], [0, 0]],
    [0, [], []],
    [30, [10, 20], [10, 20]],
  ])('splits %d over %j as %j', (total, weights, expected) => {
    expect(allocateProRata(total, weights)).toEqual(expected);
  });

  it('gives the spare cent to the largest remainder', () => {
    // Exact shares 0.25 and 0.75.
    expect(allocateProRata(1, [1, 3])).toEqual([0, 1]);
  });

  it('stays exact with very large values', () => {
    const weights = [4_503_599_627_370_495, 4_503_599_627_370_496];
    const total = Number.MAX_SAFE_INTEGER - 1;
    const shares = allocateProRata(total, weights);
    expect(sum(shares)).toBe(total);
    // Both floors lose a cent; the smaller weight has the larger remainder.
    expect(shares).toEqual([4_503_599_627_370_495, 4_503_599_627_370_495]);
  });

  it('does not modify the weights', () => {
    const weights = Object.freeze([3, 1, 2]);
    expect(() => allocateProRata(4, weights)).not.toThrow();
  });

  it.each([
    [31, [10, 20]],
    [1, [0, 0]],
    [1, []],
    [-1, [10]],
    [1.5, [10]],
    [1, [-1, 10]],
    [1, [2.5]],
  ])('throws when splitting %d over %j', (total, weights) => {
    expect(() => allocateProRata(total, weights)).toThrow(RangeError);
  });

  it('always sums to the total and never exceeds a weight', () => {
    const cases = fc
      .array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 40 })
      .chain((weights) =>
        fc.tuple(fc.constant(weights), fc.integer({ min: 0, max: sum(weights) })),
      );

    fc.assert(
      fc.property(cases, ([weights, total]) => {
        const shares = allocateProRata(total, weights);
        expect(shares).toHaveLength(weights.length);
        expect(sum(shares)).toBe(total);
        for (const [index, share] of shares.entries()) {
          expect(Number.isInteger(share)).toBe(true);
          expect(share).toBeGreaterThanOrEqual(0);
          expect(share).toBeLessThanOrEqual(weights[index]!);
        }
        expect(allocateProRata(total, weights)).toEqual(shares);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('exceedsManagerThreshold', () => {
  const check = (
    grossCents: number,
    lineDiscount: Discount | null,
    cartDiscount: Discount | null = null,
    cartBaseCents = grossCents,
    thresholdPercent = DEFAULT_MANAGER_THRESHOLD_PERCENT,
  ) =>
    exceedsManagerThreshold({
      grossCents,
      lineDiscount,
      cartDiscount,
      cartBaseCents,
      thresholdPercent,
    });

  it('defaults to 20 %', () => {
    expect(DEFAULT_MANAGER_THRESHOLD_PERCENT).toBe(20);
  });

  it.each([
    ['no discount', check(1000, null), false],
    ['line 20 %', check(1000, percent(20)), false],
    ['line 21 %', check(1000, percent(21)), true],
    ['line 20 % that rounds up in cents (1003c)', check(1003, percent(20)), false],
    ['line fixed exactly 20 %', check(1000, fixed(200)), false],
    ['line fixed 1c over 20 %', check(1000, fixed(201)), true],
    ['line fixed 201c on 1002c', check(1002, fixed(201)), true],
    ['line fixed above gross', check(1000, fixed(5000)), true],
    ['cart 20 %', check(1002, null, percent(20), 2004), false],
    ['cart 21 %', check(1002, null, percent(21), 2004), true],
    ['cart fixed exactly 20 %', check(1000, null, fixed(1000), 5000), false],
    ['cart fixed 1c over 20 %', check(1000, null, fixed(1001), 5000), true],
    ['cart fixed above the base', check(1000, null, fixed(9000), 5000), true],
    ['cart discount on an empty base', check(1000, percent(10), fixed(500), 0), false],
    ['line 20 % + cart 20 % = 36 %', check(1000, percent(20), percent(20), 800), true],
    ['line 10 % + cart 11 % = 19.9 %', check(1000, percent(10), percent(11), 900), false],
    ['line 10 % + cart 12 % = 20.8 %', check(1000, percent(10), percent(12), 900), true],
    ['free line with a discount', check(0, percent(100)), false],
  ])('%s → %s', (_label, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it('honours a custom threshold', () => {
    expect(check(1000, percent(1), null, 1000, 0)).toBe(true);
    expect(check(1000, null, null, 1000, 0)).toBe(false);
    expect(check(1000, percent(100), null, 1000, 100)).toBe(false);
    expect(check(1000, percent(30), null, 1000, 30)).toBe(false);
  });

  it.each([-1, 101, 20.5])('throws for threshold %s', (threshold) => {
    expect(() => check(1000, null, null, 1000, threshold)).toThrow(RangeError);
  });

  it('throws for invalid discounts and amounts', () => {
    expect(() => check(1000, percent(101))).toThrow(RangeError);
    expect(() => check(1000, null, fixed(-1))).toThrow(RangeError);
    expect(() => check(-1, null)).toThrow(RangeError);
    expect(() => check(1000, null, null, -1)).toThrow(RangeError);
  });

  it('never asks for approval for a cart percentage within the threshold', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: DEFAULT_MANAGER_THRESHOLD_PERCENT }),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (value, gross, others) => {
          expect(check(gross, null, percent(value), gross + others)).toBe(false);
        },
      ),
    );
  });
});
