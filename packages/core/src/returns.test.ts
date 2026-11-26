import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { calculateCart, type CartTotals, type StoreConfig } from './cart.js';
import {
  applyRefundRounding,
  refundForLines,
  ReturnError,
  type RefundableSaleLine,
  type ReturnErrorCode,
} from './returns.js';

const au: StoreConfig = {
  storeId: 'store-s01',
  taxRateBp: 1000,
  pricesIncludeTax: true,
  cashRoundingCents: 5,
};

const saleLine = (
  lineNo: number,
  qty: number,
  lineTotalCents: number,
  returnedQty?: number,
): RefundableSaleLine => ({
  lineNo,
  qty,
  lineTotalCents,
  ...(returnedQty === undefined ? {} : { returnedQty }),
});

const everything = (cart: CartTotals) => new Map(cart.lines.map((l) => [l.lineNo, l.qty]));

function expectReturnError(run: () => unknown, code: ReturnErrorCode) {
  expect(run).toThrow(ReturnError);
  expect(run).toThrow(RangeError);
  expect(run).toThrow(expect.objectContaining({ code }) as Error);
}

describe('refundForLines', () => {
  it.each([true, false])(
    'refunds the sale total minus rounding when everything is returned (inclusive: %s)',
    (pricesIncludeTax) => {
      const cart = calculateCart(
        [
          { variantId: 'a', qty: 3, unitPriceCents: 1333, discount: { type: 'fixed', value: 100 } },
          { variantId: 'b', qty: 1, unitPriceCents: 47 },
        ],
        { type: 'percent', value: 15 },
        { ...au, pricesIncludeTax },
        'cash',
      );
      expect(cart.roundingCents).not.toBe(0);

      const refund = refundForLines(cart.lines, everything(cart));

      expect(refund.refundTotalCents).toBe(cart.totalCents - cart.roundingCents);
      expect(refund.lines).toEqual(
        cart.lines.map((l) => ({
          saleLineNo: l.lineNo,
          qty: l.qty,
          refundCents: l.lineTotalCents,
        })),
      );
    },
  );

  it('refunds only the selected lines, in sale order', () => {
    const lines = [saleLine(1, 2, 1000), saleLine(2, 1, 500), saleLine(3, 4, 999)];
    const refund = refundForLines(
      lines,
      new Map([
        [3, 1],
        [1, 1],
      ]),
    );
    expect(refund).toEqual({
      lines: [
        { saleLineNo: 1, qty: 1, refundCents: 500 },
        { saleLineNo: 3, qty: 1, refundCents: 250 },
      ],
      refundTotalCents: 750,
    });
  });

  it('splits 1000c over 3 single returns exactly', () => {
    const refunds = [0, 1, 2].map(
      (returnedQty) =>
        refundForLines([saleLine(1, 3, 1000, returnedQty)], new Map([[1, 1]])).refundTotalCents,
    );
    expect(refunds).toEqual([333, 334, 333]);
  });

  it('refunds the remainder after an earlier partial return', () => {
    const refund = refundForLines([saleLine(1, 3, 1000, 1)], new Map([[1, 2]]));
    expect(refund.refundTotalCents).toBe(667);
  });

  it('refunds nothing for a free line', () => {
    expect(refundForLines([saleLine(1, 2, 0)], new Map([[1, 2]]))).toEqual({
      lines: [{ saleLineNo: 1, qty: 2, refundCents: 0 }],
      refundTotalCents: 0,
    });
  });

  it('omits zero quantities', () => {
    expect(refundForLines([saleLine(1, 2, 1000)], new Map([[1, 0]]))).toEqual({
      lines: [],
      refundTotalCents: 0,
    });
  });

  it('allows a zero quantity on a fully returned line', () => {
    expect(() => refundForLines([saleLine(1, 2, 1000, 2)], new Map([[1, 0]]))).not.toThrow();
  });

  it('returns an empty refund for an empty selection', () => {
    expect(refundForLines([saleLine(1, 2, 1000)], new Map())).toEqual({
      lines: [],
      refundTotalCents: 0,
    });
  });

  it.each([
    ['more than sold', saleLine(1, 2, 1000), 3],
    ['more than is left', saleLine(1, 3, 1000, 2), 2],
    ['anything from a fully returned line', saleLine(1, 2, 1000, 2), 1],
  ])('rejects returning %s', (_label, line, qty) => {
    expectReturnError(() => refundForLines([line], new Map([[1, qty]])), 'OVER_RETURN');
  });

  it('rejects an unknown line number', () => {
    expectReturnError(
      () => refundForLines([saleLine(1, 2, 1000)], new Map([[2, 1]])),
      'UNKNOWN_LINE',
    );
  });

  it.each([-1, 1.5, Number.NaN])('rejects return quantity %s', (qty) => {
    expectReturnError(
      () => refundForLines([saleLine(1, 2, 1000)], new Map([[1, qty]])),
      'INVALID_QTY',
    );
  });

  it.each([
    ['zero quantity', saleLine(1, 0, 1000)],
    ['negative total', saleLine(1, 1, -1)],
    ['negative returnedQty', saleLine(1, 1, 100, -1)],
    ['returnedQty above sold', saleLine(1, 1, 100, 2)],
  ])('throws for a sale line with %s', (_label, line) => {
    expect(() => refundForLines([line], new Map())).toThrow(RangeError);
  });

  it('throws for duplicate sale line numbers', () => {
    expect(() => refundForLines([saleLine(1, 1, 100), saleLine(1, 1, 100)], new Map())).toThrow(
      RangeError,
    );
  });

  it('sums exactly to the line total however the return is split', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 1, maxLength: 10 }),
        (lineTotalCents, steps) => {
          const qty = steps.reduce((sum, step) => sum + step, 0);
          let returnedQty = 0;
          let refunded = 0;
          for (const step of steps) {
            const { refundTotalCents } = refundForLines(
              [saleLine(1, qty, lineTotalCents, returnedQty)],
              new Map([[1, step]]),
            );
            expect(refundTotalCents).toBeGreaterThanOrEqual(0);
            returnedQty += step;
            refunded += refundTotalCents;
          }
          expect(refunded).toBe(lineTotalCents);
        },
      ),
    );
  });
});

describe('applyRefundRounding', () => {
  it.each([
    [1003, 2, 1005],
    [1002, -2, 1000],
    [1000, 0, 1000],
    [2, -2, 0],
    [0, 0, 0],
  ])('rounds a %dc cash refund by %dc to %dc', (total, roundingCents, refundAmountCents) => {
    expect(applyRefundRounding(total, 'cash', 5)).toEqual({ roundingCents, refundAmountCents });
  });

  it.each(['card', 'store_credit'] as const)('keeps a %s refund exact', (method) => {
    expect(applyRefundRounding(1003, method, 5)).toEqual({
      roundingCents: 0,
      refundAmountCents: 1003,
    });
  });

  it('does not round cash when rounding is off', () => {
    expect(applyRefundRounding(1003, 'cash', 0).refundAmountCents).toBe(1003);
  });

  it('throws for a negative or fractional total', () => {
    expect(() => applyRefundRounding(-1, 'card', 5)).toThrow(RangeError);
    expect(() => applyRefundRounding(1.5, 'cash', 5)).toThrow(RangeError);
  });
});
