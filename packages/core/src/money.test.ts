import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  assertCents,
  assertNonNegativeCents,
  cashRoundingAdjustment,
  changeDueCents,
  formatAUD,
  isCents,
  mulDivRoundHalfUp,
  multiplyCents,
  parseAUDToCents,
  roundCash5c,
  roundToIncrement,
  sumCents,
} from './money.js';

const MAX = Number.MAX_SAFE_INTEGER; // 9_007_199_254_740_991

describe('isCents', () => {
  it.each([0, 1, -1, 100, MAX, -MAX])('accepts the safe integer %d', (value) => {
    expect(isCents(value)).toBe(true);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '1', null, undefined, 1n])(
    'rejects %s',
    (value) => {
      expect(isCents(value)).toBe(false);
    },
  );
});

describe('assertCents / assertNonNegativeCents', () => {
  it('passes valid amounts', () => {
    expect(() => assertCents(-5)).not.toThrow();
    expect(() => assertNonNegativeCents(0)).not.toThrow();
  });

  it('throws a RangeError that names the value', () => {
    expect(() => assertCents(1.5, 'unitPriceCents')).toThrow(RangeError);
    expect(() => assertCents(1.5, 'unitPriceCents')).toThrow(/unitPriceCents/);
    expect(() => assertNonNegativeCents(-1, 'netCents')).toThrow(/netCents/);
  });

  it('rejects non-integers as non-negative cents', () => {
    expect(() => assertNonNegativeCents(0.1)).toThrow(RangeError);
  });
});

describe('sumCents', () => {
  it('sums, including the empty list', () => {
    expect(sumCents([])).toBe(0);
    expect(sumCents([1, 2, 3, -7])).toBe(-1);
  });

  it('throws on a non-integer term', () => {
    expect(() => sumCents([1, 0.5])).toThrow(RangeError);
  });

  it('throws when the sum leaves the safe range', () => {
    expect(() => sumCents([MAX, 1])).toThrow(RangeError);
  });
});

describe('multiplyCents', () => {
  it('multiplies a unit price by a quantity', () => {
    expect(multiplyCents(1999, 3)).toBe(5997);
    expect(multiplyCents(1999, 0)).toBe(0);
    expect(multiplyCents(0, 7)).toBe(0);
  });

  it.each([-1, 1.5, Number.NaN])('throws for quantity %s', (qty) => {
    expect(() => multiplyCents(100, qty)).toThrow(RangeError);
  });

  it('throws for fractional cents and unsafe results', () => {
    expect(() => multiplyCents(1.5, 2)).toThrow(RangeError);
    expect(() => multiplyCents(MAX, 2)).toThrow(RangeError);
  });
});

describe('mulDivRoundHalfUp', () => {
  it.each([
    [1, 1, 2, 1],
    [1, 1, 3, 0],
    [2, 1, 3, 1],
    [5, 1, 2, 3],
    [-1, 1, 2, -1],
    [-5, 1, 2, -3],
    [-1, 1, 3, 0],
    [2500, 1000, 11_000, 227],
    [0, 1000, 11_000, 0],
  ])('%d × %d ÷ %d = %d', (value, multiplier, divisor, expected) => {
    expect(mulDivRoundHalfUp(value, multiplier, divisor)).toBe(expected);
  });

  it('never returns negative zero', () => {
    expect(Object.is(mulDivRoundHalfUp(-1, 1, 3), 0)).toBe(true);
  });

  it('stays exact when the intermediate product exceeds the safe range', () => {
    expect(mulDivRoundHalfUp(MAX, 10_000, 10_000)).toBe(MAX);
    expect(mulDivRoundHalfUp(MAX, 1, 2)).toBe(4_503_599_627_370_496);
  });

  it.each([0, -1])('throws for divisor %d', (divisor) => {
    expect(() => mulDivRoundHalfUp(1, 1, divisor)).toThrow(RangeError);
  });

  it('throws for non-integer arguments and unsafe results', () => {
    expect(() => mulDivRoundHalfUp(1.5, 1, 1)).toThrow(RangeError);
    expect(() => mulDivRoundHalfUp(1, 1.5, 1)).toThrow(RangeError);
    expect(() => mulDivRoundHalfUp(1, 1, 1.5)).toThrow(RangeError);
    expect(() => mulDivRoundHalfUp(MAX, 2, 1)).toThrow(RangeError);
  });
});

describe('roundCash5c', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 5],
    [4, 5],
    [5, 5],
    [6, 5],
    [7, 5],
    [8, 10],
    [9, 10],
    [10, 10],
    [-1, 0],
    [-2, 0],
    [-3, -5],
    [-7, -5],
    [-8, -10],
    [999_999_999_998, 1_000_000_000_000],
    [MAX, 9_007_199_254_740_990],
  ])('rounds %d to %d', (cents, expected) => {
    expect(roundCash5c(cents)).toBe(expected);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundCash5c(-2), 0)).toBe(true);
    expect(Object.is(roundCash5c(-0), 0)).toBe(true);
  });

  it('throws for fractional cents', () => {
    expect(() => roundCash5c(2.5)).toThrow(RangeError);
  });

  it('always returns a multiple of 5 within 2c of the input', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (cents) => {
        const rounded = roundCash5c(cents);
        expect(Math.abs(rounded % 5)).toBe(0);
        expect(Math.abs(rounded - cents)).toBeLessThanOrEqual(2);
      }),
    );
  });
});

describe('roundToIncrement', () => {
  it('rounds ties up (away from zero)', () => {
    expect(roundToIncrement(5, 10)).toBe(10);
    expect(roundToIncrement(4, 10)).toBe(0);
    expect(roundToIncrement(-5, 10)).toBe(-10);
  });

  it('leaves values unchanged with an increment of 1', () => {
    expect(roundToIncrement(1234, 1)).toBe(1234);
  });

  it.each([0, -5, 1.5])('throws for increment %s', (increment) => {
    expect(() => roundToIncrement(10, increment)).toThrow(RangeError);
  });

  it('throws when rounding up leaves the safe range', () => {
    expect(() => roundToIncrement(MAX, 2)).toThrow(RangeError);
  });
});

describe('cashRoundingAdjustment', () => {
  it.each([
    [0, 0],
    [1, -1],
    [2, -2],
    [3, 2],
    [7, -2],
    [8, 2],
    [1000, 0],
    [1003, 2],
  ])('adjusts %dc by %dc for 5c rounding', (amount, adjustment) => {
    expect(cashRoundingAdjustment(amount, 5)).toBe(adjustment);
  });

  it.each([0, 1])('is zero when the increment is %d', (increment) => {
    expect(cashRoundingAdjustment(1003, increment)).toBe(0);
  });

  it.each([
    [-1, 5],
    [1.5, 5],
    [100, -5],
    [100, 2.5],
  ])('throws for amount %s with increment %s', (amount, increment) => {
    expect(() => cashRoundingAdjustment(amount, increment)).toThrow(RangeError);
  });
});

describe('formatAUD', () => {
  it.each([
    [0, '$0.00'],
    [-0, '$0.00'],
    [1, '$0.01'],
    [2, '$0.02'],
    [3, '$0.03'],
    [7, '$0.07'],
    [10, '$0.10'],
    [100, '$1.00'],
    [99_999, '$999.99'],
    [100_000, '$1,000.00'],
    [123_456_789, '$1,234,567.89'],
    [-5, '-$0.05'],
    [-250, '-$2.50'],
    [MAX, '$90,071,992,547,409.91'],
  ])('formats %d as %s', (cents, expected) => {
    expect(formatAUD(cents)).toBe(expected);
  });

  it.each([1.5, Number.NaN, 2 ** 53])('throws for %s', (cents) => {
    expect(() => formatAUD(cents)).toThrow(RangeError);
  });
});

describe('changeDueCents', () => {
  it.each([
    [0, 0, 0],
    [1000, 1000, 0],
    [1001, 1000, 1],
    [5000, 1235, 3765],
    [MAX, 1, MAX - 1],
  ])('gives back %d - %d = %d', (tendered, total, change) => {
    expect(changeDueCents(tendered, total)).toBe(change);
  });

  it('throws when the money handed over is short', () => {
    expect(() => changeDueCents(999, 1000)).toThrow(RangeError);
  });

  it.each([
    [-1, 0],
    [0, -1],
    [10.5, 10],
    [10, 9.5],
    [Number.NaN, 0],
  ])('throws for %s tendered against %s', (tendered, total) => {
    expect(() => changeDueCents(tendered, total)).toThrow(RangeError);
  });
});

describe('parseAUDToCents', () => {
  it.each([
    ['0', 0],
    ['50', 5000],
    ['50.', 5000],
    ['12.5', 1250],
    ['12.05', 1205],
    ['.50', 50],
    ['0.01', 1],
    [' $5 ', 500],
    ['$1,234.56', 123456],
    ['1234567', 123456700],
    ['19.99', 1999],
    ['90071992547409.91', MAX],
  ])('reads %j as %d cents', (text, cents) => {
    expect(parseAUDToCents(text)).toBe(cents);
  });

  it.each([
    '',
    '   ',
    '$',
    '.',
    '-5',
    '+5',
    '5.001',
    '1.2.3',
    '12,34',
    '1,2345',
    'five',
    '5c',
    '1e3',
    '5 0',
    '90071992547409.92',
  ])('refuses %j', (text) => {
    expect(parseAUDToCents(text)).toBeNull();
  });

  it('reads back whatever formatAUD writes', () => {
    fc.assert(
      fc.property(fc.nat({ max: MAX }), (cents) => {
        expect(parseAUDToCents(formatAUD(cents))).toBe(cents);
      }),
    );
  });
});
