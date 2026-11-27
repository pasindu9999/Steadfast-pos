import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  receiptLookupResponseSchema,
  receiptNoInputSchema,
  type ReceiptLookupResponse,
} from './receipts.js';

const v7 = (n: number) => `01920f3a-7b2c-7000-8000-${String(n).padStart(12, '0')}`;

const line = {
  lineNo: 1,
  variantId: '55555555-5555-4555-8555-555555555555',
  skuSnapshot: 'LIN-BK-M',
  nameSnapshot: 'Linen Shirt — Black / M',
  qty: 2,
  unitPriceCents: 8900,
  lineDiscountCents: 0,
  taxCents: 1618,
  lineTotalCents: 17_800,
  returnedQty: 1,
};

const response = {
  saleId: v7(1),
  receiptNo: 'S01-T2-000123',
  storeId: '22222222-2222-4222-8222-222222222222',
  terminalId: '33333333-3333-4333-8333-333333333333',
  staffId: null,
  status: 'completed',
  occurredAt: '2026-11-26T03:15:00.000Z',
  voidedAt: null,
  subtotalCents: 17_800,
  discountCents: 0,
  taxCents: 1618,
  roundingCents: 0,
  totalCents: 17_800,
  lines: [line],
  payments: [
    {
      method: 'card',
      amountCents: 17_800,
      tenderedCents: null,
      changeCents: null,
      cardReference: 'APPROVED-1',
      cardLast4: '4242',
    },
  ],
};

const accepts = (value: unknown) => receiptLookupResponseSchema.safeParse(value).success;

describe('receiptNoInputSchema', () => {
  it.each(['S01-T2-000123', ' s01-t2-000123 '])('normalises "%s"', (input) => {
    expect(receiptNoInputSchema.parse(input)).toBe('S01-T2-000123');
  });

  it.each(['', 'S01-T2', 'R-S01-T2-000017', 'S01-T2-000000', 'x'.repeat(65), 7])(
    'rejects %o',
    (input) => {
      expect(receiptNoInputSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('receiptLookupResponseSchema', () => {
  it('accepts a sale with what has been returned from each line', () => {
    expect(receiptLookupResponseSchema.parse(response)).toEqual(response);
    expectTypeOf<ReceiptLookupResponse['lines'][number]['returnedQty']>().toEqualTypeOf<number>();
  });

  it('accepts a voided sale', () => {
    expect(accepts({ ...response, status: 'voided', voidedAt: response.occurredAt })).toBe(true);
  });

  it.each([
    { status: 'refunded' },
    { lines: [] },
    { lines: [{ ...line, returnedQty: -1 }] },
    { lines: [{ ...line, returnedQty: undefined }] },
    { totalCents: 1.5 },
    { payments: [] },
  ])('rejects %o', (override) => {
    expect(accepts({ ...response, ...override })).toBe(false);
  });
});
