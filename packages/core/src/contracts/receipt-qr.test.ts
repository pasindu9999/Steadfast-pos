import { describe, expect, it } from 'vitest';

import { encodeReceiptQr, receiptQrSchema } from './receipt-qr.js';

const saleId = '01920f3a-7b2c-7000-8000-000000000001';
const linen = '55555555-5555-4555-8555-555555555555';
const tee = '66666666-6666-4666-8666-666666666666';

const sale = {
  saleId,
  receiptNo: 'S01-T1-000123',
  lines: [
    { lineNo: 1, variantId: linen, qty: 2, lineTotalCents: 17800 },
    { lineNo: 2, variantId: tee, qty: 1, lineTotalCents: 0 },
  ],
};

describe('encodeReceiptQr', () => {
  it('writes the payload of ARCH §7.4', () => {
    expect(encodeReceiptQr(sale)).toBe(
      `{"saleId":"${saleId}","receiptNo":"S01-T1-000123",` +
        `"lines":[["${linen}",2,17800],["${tee}",1,0]]}`,
    );
  });

  it('puts the lines in line number order', () => {
    const reversed = { ...sale, lines: [...sale.lines].reverse() };

    expect(encodeReceiptQr(reversed)).toBe(encodeReceiptQr(sale));
    // The caller's array is not reordered.
    expect(reversed.lines[0]?.lineNo).toBe(2);
  });

  it('can be read back by the schema', () => {
    expect(receiptQrSchema.parse(JSON.parse(encodeReceiptQr(sale)))).toEqual({
      saleId,
      receiptNo: 'S01-T1-000123',
      lines: [
        [linen, 2, 17800],
        [tee, 1, 0],
      ],
    });
  });

  it('refuses lines whose position would not be their line number', () => {
    for (const numbers of [
      [1, 3],
      [2, 3],
      [1, 1],
    ]) {
      const lines = sale.lines.map((line, index) => ({ ...line, lineNo: numbers[index]! }));
      expect(() => encodeReceiptQr({ ...sale, lines })).toThrow(RangeError);
    }
  });
});

describe('receiptQrSchema', () => {
  const payload = { saleId, receiptNo: 'S01-T1-000123', lines: [[linen, 1, 8900]] };

  it.each([
    ['a sale id that no terminal made', { ...payload, saleId: linen }],
    ['a bad receipt number', { ...payload, receiptNo: '123' }],
    ['no lines', { ...payload, lines: [] }],
    ['more lines than a sale holds', { ...payload, lines: Array(201).fill([linen, 1, 1]) }],
    ['a zero quantity', { ...payload, lines: [[linen, 0, 8900]] }],
    ['a fraction of a cent', { ...payload, lines: [[linen, 1, 89.5]] }],
    ['a negative total', { ...payload, lines: [[linen, 1, -1]] }],
    ['a missing value', { ...payload, lines: [[linen, 1]] }],
    ['an extra value', { ...payload, lines: [[linen, 1, 1, 1]] }],
  ])('rejects %s', (_, bad) => {
    expect(receiptQrSchema.safeParse(bad).success).toBe(false);
  });
});
