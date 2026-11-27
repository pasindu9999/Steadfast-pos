import { calculateCart, type SaleCompletedPayload } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { saleFlags, type SaleFlagInput } from './sale-flags.js';

const VARIANT = '55555555-5555-4555-8555-555555555555';
const OTHER = '66666666-6666-4666-8666-666666666666';
const STORE = {
  storeId: '22222222-2222-4222-8222-222222222222',
  taxRateBp: 1000,
  pricesIncludeTax: true,
  cashRoundingCents: 5,
};
const NOW = new Date('2026-11-26T03:00:00.000Z');

/** Two lines with a line discount and a cart discount; $0.02 of cash rounding. */
function payload(tender: 'cash' | 'card' = 'cash'): SaleCompletedPayload {
  const cart = [
    { variantId: VARIANT, qty: 2, unitPriceCents: 1999, discount: null },
    {
      variantId: OTHER,
      qty: 1,
      unitPriceCents: 1000,
      discount: { type: 'fixed' as const, value: 1 },
    },
  ];
  const cartDiscount = { type: 'percent' as const, value: 10 };
  const totals = calculateCart(cart, cartDiscount, STORE, tender);
  return {
    saleId: '01920f3a-7b2c-7000-8000-000000000001',
    receiptNo: 'S01-T1-000001',
    storeId: STORE.storeId,
    staffId: null,
    cartDiscount,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    roundingCents: totals.roundingCents,
    totalCents: totals.totalCents,
    lines: totals.lines.map((line, index) => ({
      lineId: `01920f3a-7b2c-7000-8000-00000000001${index}`,
      lineNo: line.lineNo,
      variantId: line.variantId,
      skuSnapshot: 'SKU',
      nameSnapshot: 'Name',
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      discount: cart[index]!.discount,
      lineDiscountCents: line.discountCents,
      taxCents: line.taxCents,
      lineTotalCents: line.lineTotalCents,
    })),
    payments: [
      {
        paymentId: '01920f3a-7b2c-7000-8000-000000000002',
        method: tender,
        amountCents: totals.totalCents,
        tenderedCents: null,
        changeCents: null,
        cardReference: null,
        cardLast4: null,
      },
    ],
  };
}

const flags = (override: Partial<SaleFlagInput> = {}) =>
  saleFlags({
    payload: payload(),
    store: STORE,
    currentPrices: new Map([
      [VARIANT, 1999],
      [OTHER, 1000],
    ]),
    occurredAt: NOW,
    receivedAt: NOW,
    staffKnown: true,
    ...override,
  });

const minutesAfter = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe('saleFlags', () => {
  it.each(['cash', 'card'] as const)('raises none for a correct %s sale', (tender) => {
    expect(flags({ payload: payload(tender) })).toEqual([]);
  });

  it('checks lines by lineNo, whatever order they arrive in', () => {
    const sale = payload();

    expect(flags({ payload: { ...sale, lines: [...sale.lines].reverse() } })).toEqual([]);
  });

  it.each(['subtotalCents', 'discountCents', 'taxCents', 'roundingCents', 'totalCents'] as const)(
    'flags a wrong %s',
    (field) => {
      const sale = payload();

      expect(flags({ payload: { ...sale, [field]: sale[field] + 1 } })).toEqual(['total_mismatch']);
    },
  );

  it.each(['lineDiscountCents', 'taxCents', 'lineTotalCents'] as const)(
    'flags a wrong %s on a line',
    (field) => {
      const sale = payload();
      const [first, second] = sale.lines;

      expect(
        flags({
          payload: { ...sale, lines: [{ ...first!, [field]: first![field] + 1 }, second!] },
        }),
      ).toEqual(['total_mismatch']);
    },
  );

  it('flags payments that do not add up to the total', () => {
    const sale = payload();
    const [payment] = sale.payments;

    expect(
      flags({
        payload: {
          ...sale,
          payments: [{ ...payment!, amountCents: payment!.amountCents - 1 }],
        },
      }),
    ).toEqual(['total_mismatch']);
  });

  it('flags a sale too large to price instead of failing', () => {
    const sale = payload();
    const huge = { ...sale.lines[0]!, qty: 2_147_483_647, unitPriceCents: 2_147_483_647 };

    expect(
      flags({
        payload: { ...sale, lines: [huge] },
        currentPrices: new Map([[VARIANT, huge.unitPriceCents]]),
      }),
    ).toEqual(['total_mismatch']);
  });

  it('flags a price that differs from the catalogue', () => {
    expect(
      flags({
        currentPrices: new Map([
          [VARIANT, 2499],
          [OTHER, 1000],
        ]),
      }),
    ).toEqual(['price_drift']);
  });

  it.each([
    [-60 * 24 * 7, []],
    [10, []],
    [10.1, ['clock_skew']],
  ])('judges a device clock %s minutes from the server', (minutes, expected) => {
    expect(flags({ occurredAt: minutesAfter(minutes) })).toEqual(expected);
  });

  it('flags an unknown staff member', () => {
    expect(flags({ staffKnown: false })).toEqual(['unknown_staff']);
  });

  it('can raise every flag at once', () => {
    const sale = payload();

    expect(
      flags({
        payload: { ...sale, totalCents: 1 },
        currentPrices: new Map(),
        occurredAt: minutesAfter(60),
        staffKnown: false,
      }),
    ).toEqual(['total_mismatch', 'price_drift', 'clock_skew', 'unknown_staff']);
  });
});
