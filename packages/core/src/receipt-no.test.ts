import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { formatReceiptNo, formatReturnNo, parseReceiptNo, parseReturnNo } from './receipt-no.js';

const parts = (seq: number, storeCode = 'S01', terminalCode = 'T2') => ({
  storeCode,
  terminalCode,
  seq,
});

describe('formatReceiptNo / formatReturnNo', () => {
  it('formats the examples from ARCH §4.3', () => {
    expect(formatReceiptNo(parts(123))).toBe('S01-T2-000123');
    expect(formatReturnNo(parts(17))).toBe('R-S01-T2-000017');
  });

  it.each([
    [1, 'S01-T2-000001'],
    [999_999, 'S01-T2-999999'],
    [1_000_000, 'S01-T2-1000000'],
    [Number.MAX_SAFE_INTEGER, 'S01-T2-9007199254740991'],
  ])('formats seq %d as %s', (seq, expected) => {
    expect(formatReceiptNo(parts(seq))).toBe(expected);
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53])('throws for seq %s', (seq) => {
    expect(() => formatReceiptNo(parts(seq))).toThrow(RangeError);
    expect(() => formatReturnNo(parts(seq))).toThrow(RangeError);
  });

  it.each(['', 's01', 'S-01', 'S 1', 'S01234567'])('throws for code "%s"', (code) => {
    expect(() => formatReceiptNo(parts(1, code))).toThrow(RangeError);
    expect(() => formatReceiptNo(parts(1, 'S01', code))).toThrow(RangeError);
    expect(() => formatReturnNo(parts(1, code))).toThrow(RangeError);
  });
});

describe('parseReceiptNo', () => {
  it('parses a receipt number', () => {
    expect(parseReceiptNo('S01-T2-000123')).toEqual(parts(123));
  });

  it('accepts typed input with spaces around it and lower case', () => {
    expect(parseReceiptNo('  s01-t2-000123\n')).toEqual(parts(123));
  });

  it('parses a sequence beyond six digits', () => {
    expect(parseReceiptNo('S01-T2-1000000')).toEqual(parts(1_000_000));
  });

  it.each([
    '',
    'S01-T2',
    'S01-T2-123',
    'S01-T2-0000123',
    'S01-T2-000000',
    'S01-T2-00012a',
    'S01-T2-9007199254740992',
    'S01--000123',
    'S01 T2 000123',
    'S01-T2-000123-1',
    'TOOLONGCODE-T2-000123',
    'R-S01-T2-000017',
  ])('rejects "%s"', (input) => {
    expect(parseReceiptNo(input)).toBeNull();
  });
});

describe('parseReturnNo', () => {
  it('parses a return number', () => {
    expect(parseReturnNo('R-S01-T2-000017')).toEqual(parts(17));
    expect(parseReturnNo(' r-s01-t2-000017 ')).toEqual(parts(17));
  });

  it.each([
    '',
    'S01-T2-000017',
    'R-S01-T2-17',
    'R-S01-T2-000000',
    'X-S01-T2-000017',
    'RS01-T2-000017',
    'R-R-S01-T2-000017',
  ])('rejects "%s"', (input) => {
    expect(parseReturnNo(input)).toBeNull();
  });
});

describe('round trip', () => {
  const codeArb = fc.stringMatching(/^[A-Z0-9]{1,8}$/);
  const partsArb = fc.record({
    storeCode: codeArb,
    terminalCode: codeArb,
    seq: fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  });

  it('parses everything it formats, without mixing the two kinds', () => {
    fc.assert(
      fc.property(partsArb, (input) => {
        const sale = formatReceiptNo(input);
        const refund = formatReturnNo(input);
        expect(parseReceiptNo(sale)).toEqual(input);
        expect(parseReturnNo(refund)).toEqual(input);
        expect(parseReceiptNo(refund)).toBeNull();
        expect(parseReturnNo(sale)).toBeNull();
      }),
    );
  });
});
