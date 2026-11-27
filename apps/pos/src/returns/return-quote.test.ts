import { ReturnError } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { LINEN_ID, TEE_ID } from '../test/checkout-fixtures';
import { OTHER_SALE_ID } from '../test/return-fixtures';
import type { ReturnableLine, ReturnableSale } from './load-returnable';
import { quoteReturn, type ReturnSelection } from './return-quote';

const line = (fields: Partial<ReturnableLine> = {}): ReturnableLine => ({
  lineNo: 1,
  variantId: LINEN_ID,
  name: 'Linen Shirt — Black / M',
  soldQty: 3,
  returnedQty: 0,
  lineTotalCents: 24_030,
  ...fields,
});

const sale = (lines: ReturnableLine[] = [line()], onRecord = true): ReturnableSale => ({
  ref: { kind: 'local', saleId: OTHER_SALE_ID },
  saleId: OTHER_SALE_ID,
  receiptNo: 'S01-T1-000001',
  onRecord,
  status: 'completed',
  occurredAt: null,
  tender: 'cash',
  totalCents: null,
  lines,
});

const take = (qty = 1, lineNo = 1, restock = true): ReturnSelection => ({ lineNo, qty, restock });

describe('quoteReturn: amounts', () => {
  it('refunds a share of what was paid for the line, discounts included', () => {
    // Three at $89 less 10%: $80.10 each.
    expect(quoteReturn(sale(), [take()], 'card', 5)).toEqual({
      lines: [
        {
          saleLineNo: 1,
          variantId: LINEN_ID,
          name: 'Linen Shirt — Black / M',
          qty: 1,
          refundCents: 8010,
          restock: true,
        },
      ],
      refundTotalCents: 8010,
      roundingCents: 0,
      refundAmountCents: 8010,
      needsApproval: false,
    });
  });

  it('counts earlier returns, so the parts add up to the line total', () => {
    const refunds = [0, 1, 2].map(
      (returnedQty) =>
        quoteReturn(sale([line({ lineTotalCents: 1000, returnedQty })]), [take()], 'card', 5)
          .refundTotalCents,
    );

    expect(refunds).toEqual([333, 334, 333]);
  });

  it.each([
    [1003, 2, 1005],
    [1002, -2, 1000],
    [2, -2, 0],
  ])('rounds a %dc cash refund by %dc', (lineTotalCents, roundingCents, refundAmountCents) => {
    const one = sale([line({ soldQty: 1, lineTotalCents })]);

    expect(quoteReturn(one, [take()], 'cash', 5)).toMatchObject({
      refundTotalCents: lineTotalCents,
      roundingCents,
      refundAmountCents,
    });
    expect(quoteReturn(one, [take()], 'card', 5).refundAmountCents).toBe(lineTotalCents);
  });

  it('does not round until a method is chosen', () => {
    const one = sale([line({ soldQty: 1, lineTotalCents: 1003 })]);

    expect(quoteReturn(one, [take()], null, 5)).toMatchObject({
      roundingCents: 0,
      refundAmountCents: 1003,
    });
  });

  it('rounds the whole refund once, not line by line', () => {
    const two = sale([
      line({ soldQty: 1, lineTotalCents: 1002 }),
      line({ lineNo: 2, variantId: TEE_ID, soldQty: 1, lineTotalCents: 1002 }),
    ]);

    expect(quoteReturn(two, [take(1, 1), take(1, 2, false)], 'cash', 5)).toMatchObject({
      refundTotalCents: 2004,
      roundingCents: 1,
      refundAmountCents: 2005,
      lines: [
        { saleLineNo: 1, restock: true },
        { saleLineNo: 2, variantId: TEE_ID, restock: false },
      ],
    });
  });

  it('is nothing when nothing is selected', () => {
    for (const selections of [[], [take(0)]]) {
      expect(quoteReturn(sale(), selections, 'cash', 5)).toMatchObject({
        lines: [],
        refundTotalCents: 0,
        refundAmountCents: 0,
      });
    }
  });
});

describe('quoteReturn: approval', () => {
  const worth = (lineTotalCents: number, onRecord: boolean) =>
    quoteReturn(sale([line({ soldQty: 1, lineTotalCents })], onRecord), [take()], 'cash', 5);

  it('asks above $100.00, judged before cash rounding', () => {
    expect(worth(10_000, true).needsApproval).toBe(false);
    // $100.01 is handed back as $100.00, and still needs a manager.
    expect(worth(10_001, true)).toMatchObject({ refundAmountCents: 10_000, needsApproval: true });
  });

  it('always asks for a sale this terminal has no record of', () => {
    expect(worth(100, false).needsApproval).toBe(true);
  });
});

describe('quoteReturn: refusals', () => {
  it('refuses more than is left to return', () => {
    const part = sale([line({ returnedQty: 2 })]);

    expect(() => quoteReturn(part, [take(2)], 'cash', 5)).toThrow(
      expect.objectContaining({ code: 'OVER_RETURN' }) as Error,
    );
  });

  it.each([-1, 1.5, Number.NaN])('refuses a quantity of %s', (qty) => {
    expect(() => quoteReturn(sale(), [take(qty)], 'cash', 5)).toThrow(ReturnError);
  });

  it('refuses a line the sale does not have, and a line chosen twice', () => {
    expect(() => quoteReturn(sale(), [take(1, 2)], 'cash', 5)).toThrow(ReturnError);
    expect(() => quoteReturn(sale(), [take(1), take(1)], 'cash', 5)).toThrow(RangeError);
  });
});
