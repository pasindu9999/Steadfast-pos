import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { calculateCart, type CartLineInput, type StoreConfig } from './cart.js';
import type { Discount } from './discounts.js';

const au: StoreConfig = {
  storeId: 'store-s01',
  taxRateBp: 1000,
  pricesIncludeTax: true,
  cashRoundingCents: 5,
};
const exclusive: StoreConfig = { ...au, pricesIncludeTax: false };

const line = (
  unitPriceCents: number,
  qty = 1,
  discount: Discount | null = null,
  variantId = `variant-${unitPriceCents}`,
): CartLineInput => ({ variantId, qty, unitPriceCents, discount });

const percent = (value: number): Discount => ({ type: 'percent', value });
const fixed = (value: number): Discount => ({ type: 'fixed', value });

describe('calculateCart, representative carts', () => {
  it('1: one line, no discount, card', () => {
    const cart = calculateCart([line(8900)], null, au, 'card');

    expect(cart).toMatchObject({
      subtotalCents: 8900,
      discountCents: 0,
      taxCents: 809,
      roundingCents: 0,
      totalCents: 8900,
      requiresManagerApproval: false,
    });
    expect(cart).toMatchSnapshot();
  });

  it('2: two lines paid in cash, rounded down', () => {
    const cart = calculateCart([line(1999, 2), line(3004)], null, au, 'cash');

    expect(cart).toMatchObject({
      subtotalCents: 7002,
      discountCents: 0,
      taxCents: 636,
      roundingCents: -2,
      totalCents: 7000,
      requiresManagerApproval: false,
    });
    expect(cart).toMatchSnapshot();
  });

  it('3: line percentage plus cart percentage, cash', () => {
    const cart = calculateCart([line(4995, 2, percent(10)), line(2500)], percent(15), au, 'cash');

    expect(cart).toMatchObject({
      subtotalCents: 12_490,
      discountCents: 2723,
      taxCents: 888,
      roundingCents: -2,
      totalCents: 9765,
      requiresManagerApproval: true,
    });
    expect(cart.lines[0]).toMatchObject({
      grossCents: 9990,
      ownDiscountCents: 999,
      cartDiscountCents: 1349,
      discountCents: 2348,
      netCents: 7642,
      taxCents: 695,
      lineTotalCents: 7642,
      exceedsDiscountThreshold: true,
    });
    expect(cart.lines[1]).toMatchObject({
      ownDiscountCents: 0,
      cartDiscountCents: 375,
      netCents: 2125,
      taxCents: 193,
      exceedsDiscountThreshold: false,
    });
    expect(cart).toMatchSnapshot();
  });

  it('4: fixed cart discount larger than the cart is capped', () => {
    const cart = calculateCart([line(1500), line(999)], fixed(5000), au, 'cash');

    expect(cart).toMatchObject({
      subtotalCents: 2499,
      discountCents: 2499,
      taxCents: 0,
      roundingCents: 0,
      totalCents: 0,
      requiresManagerApproval: true,
    });
    expect(cart.lines.map((l) => l.lineTotalCents)).toEqual([0, 0]);
    expect(cart).toMatchSnapshot();
  });

  it('5: tax-exclusive store, cash rounded up', () => {
    const cart = calculateCart([line(1333, 3, fixed(100)), line(45)], null, exclusive, 'cash');

    expect(cart).toMatchObject({
      subtotalCents: 4044,
      discountCents: 100,
      taxCents: 395,
      roundingCents: 1,
      totalCents: 4340,
      requiresManagerApproval: false,
    });
    expect(cart.lines[0]).toMatchObject({ netCents: 3899, taxCents: 390, lineTotalCents: 4289 });
    expect(cart.lines[1]).toMatchObject({ netCents: 45, taxCents: 5, lineTotalCents: 50 });
    expect(cart).toMatchSnapshot();
  });
});

describe('calculateCart, edge cases', () => {
  it('returns zeros for an empty cart', () => {
    expect(calculateCart([], percent(10), au, 'cash')).toEqual({
      lines: [],
      subtotalCents: 0,
      discountCents: 0,
      taxCents: 0,
      roundingCents: 0,
      totalCents: 0,
      requiresManagerApproval: false,
    });
  });

  it('numbers lines from 1 in input order and keeps the variant', () => {
    const cart = calculateCart(
      [line(100, 1, null, 'a'), line(200, 1, null, 'a'), line(300, 1, null, 'b')],
      null,
      au,
      'card',
    );
    expect(cart.lines.map((l) => [l.lineNo, l.variantId])).toEqual([
      [1, 'a'],
      [2, 'a'],
      [3, 'b'],
    ]);
  });

  it('treats a missing line discount as none', () => {
    const cart = calculateCart([{ variantId: 'a', qty: 1, unitPriceCents: 500 }], null, au, 'card');
    expect(cart.discountCents).toBe(0);
  });

  it('never rounds a card total', () => {
    expect(calculateCart([line(7002)], null, au, 'card')).toMatchObject({
      roundingCents: 0,
      totalCents: 7002,
    });
  });

  it.each([0, 1])('does not round cash when cashRoundingCents is %d', (cashRoundingCents) => {
    const config = { ...au, cashRoundingCents };
    expect(calculateCart([line(7002)], null, config, 'cash').totalCents).toBe(7002);
  });

  it('rounds a 2c cash sale down to zero', () => {
    expect(calculateCart([line(2)], null, au, 'cash')).toMatchObject({
      roundingCents: -2,
      totalCents: 0,
    });
  });

  it('uses the store discount threshold', () => {
    const strict = { ...au, managerDiscountThresholdPercent: 5 };
    expect(calculateCart([line(1000, 1, percent(10))], null, au, 'card')).toMatchObject({
      requiresManagerApproval: false,
    });
    expect(calculateCart([line(1000, 1, percent(10))], null, strict, 'card')).toMatchObject({
      requiresManagerApproval: true,
    });
  });

  it('does not ask for a PIN when penny allocation lands on one line', () => {
    const cart = calculateCart([line(1002), line(1002)], percent(20), au, 'card');
    expect(cart.lines.map((l) => l.cartDiscountCents)).toEqual([201, 200]);
    expect(cart.requiresManagerApproval).toBe(false);
  });

  it.each([0, -1, 1.5])('throws for qty %s', (qty) => {
    expect(() => calculateCart([line(100, qty)], null, au, 'cash')).toThrow(RangeError);
  });

  it.each([-1, 1.5])('throws for unit price %s', (price) => {
    expect(() => calculateCart([line(price)], null, au, 'cash')).toThrow(RangeError);
  });

  it('throws for invalid discounts', () => {
    expect(() => calculateCart([line(100, 1, percent(101))], null, au, 'cash')).toThrow(RangeError);
    expect(() => calculateCart([line(100)], fixed(-1), au, 'cash')).toThrow(RangeError);
  });

  it.each([-5, 2.5])('throws for cashRoundingCents %s', (cashRoundingCents) => {
    const config = { ...au, cashRoundingCents };
    expect(() => calculateCart([line(100)], null, config, 'cash')).toThrow(RangeError);
  });

  it('does not modify its input', () => {
    const lines = Object.freeze([Object.freeze(line(4995, 2, Object.freeze(percent(10))))]);
    expect(() => calculateCart(lines, Object.freeze(percent(15)), au, 'cash')).not.toThrow();
  });
});

describe('calculateCart, properties', () => {
  const discountArb: fc.Arbitrary<Discount | null> = fc.oneof(
    fc.constant(null),
    fc.integer({ min: 0, max: 100 }).map(percent),
    fc.integer({ min: 0, max: 200_000 }).map(fixed),
  );
  const lineArb: fc.Arbitrary<CartLineInput> = fc.record({
    variantId: fc.constant('v'),
    qty: fc.integer({ min: 1, max: 50 }),
    unitPriceCents: fc.integer({ min: 0, max: 100_000 }),
    discount: discountArb,
  });

  it('always reconciles', () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { maxLength: 20 }),
        discountArb,
        fc.integer({ min: 0, max: 10_000 }),
        fc.boolean(),
        fc.constantFrom('cash' as const, 'card' as const),
        (lines, cartDiscount, taxRateBp, pricesIncludeTax, tender) => {
          const config = { ...au, taxRateBp, pricesIncludeTax };
          const cart = calculateCart(lines, cartDiscount, config, tender);
          const total = (pick: (l: (typeof cart.lines)[number]) => number) =>
            cart.lines.reduce((sum, l) => sum + pick(l), 0);

          expect(cart.subtotalCents).toBe(total((l) => l.grossCents));
          expect(cart.discountCents).toBe(total((l) => l.discountCents));
          expect(cart.taxCents).toBe(total((l) => l.taxCents));
          expect(cart.totalCents).toBe(
            cart.subtotalCents -
              cart.discountCents +
              (pricesIncludeTax ? 0 : cart.taxCents) +
              cart.roundingCents,
          );
          expect(cart.totalCents).toBe(total((l) => l.lineTotalCents) + cart.roundingCents);

          const cartBase = total((l) => l.grossCents - l.ownDiscountCents);
          const expectedCartDiscount =
            cartDiscount === null
              ? 0
              : cartDiscount.type === 'fixed'
                ? Math.min(cartDiscount.value, cartBase)
                : Math.round((cartBase * cartDiscount.value) / 100);
          expect(total((l) => l.cartDiscountCents)).toBe(expectedCartDiscount);

          for (const l of cart.lines) {
            for (const value of [
              l.ownDiscountCents,
              l.cartDiscountCents,
              l.netCents,
              l.taxCents,
              l.lineTotalCents,
            ]) {
              expect(Number.isSafeInteger(value)).toBe(true);
              expect(value).toBeGreaterThanOrEqual(0);
            }
            expect(l.netCents).toBe(l.grossCents - l.discountCents);
          }

          expect(cart.totalCents).toBeGreaterThanOrEqual(0);
          if (tender === 'cash') {
            expect(cart.totalCents % 5).toBe(0);
            expect(Math.abs(cart.roundingCents)).toBeLessThanOrEqual(2);
          } else {
            expect(cart.roundingCents).toBe(0);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
