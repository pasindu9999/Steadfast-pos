import { decodeReceiptQr } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { otherTerminalQr } from '../test/return-fixtures';
import { isReceiptEntry, parseLookup } from './parse-lookup';

describe('parseLookup', () => {
  it.each(['S01-T1-000123', ' s01-t1-000123 ', 'S01-T1-000123\n'])(
    'reads the receipt number in %j',
    (text) => {
      expect(parseLookup(text)).toEqual({ type: 'receipt_no', receiptNo: 'S01-T1-000123' });
    },
  );

  it('reads the code on a receipt', () => {
    const text = otherTerminalQr();

    expect(parseLookup(` ${text} `)).toEqual({ type: 'qr', qr: decodeReceiptQr(text) });
  });

  it.each([
    ['cut short', otherTerminalQr().slice(0, -5)],
    ['not a receipt', '{"saleId":"nope"}'],
  ])('says a code is unreadable when it is %s', (_, text) => {
    expect(parseLookup(text)).toEqual({ type: 'invalid_qr' });
  });

  it('knows a return number from a receipt number', () => {
    expect(parseLookup('r-s01-t1-000017')).toEqual({ type: 'return_no' });
  });

  it.each(['linen', '2000000000077', 'S01-T1-12', 'S01-T1-000000'])(
    'does not take %j for a receipt',
    (text) => {
      expect(parseLookup(text)).toEqual({ type: 'unrecognised' });
    },
  );

  it.each(['', '   '])('is empty for %j', (text) => {
    expect(parseLookup(text)).toEqual({ type: 'empty' });
  });
});

describe('isReceiptEntry', () => {
  it.each(['S01-T1-000123', 'R-S01-T1-000001', otherTerminalQr(), '{"cut'])(
    'sends %j to Returns',
    (text) => {
      expect(isReceiptEntry(text)).toBe(true);
    },
  );

  it.each(['', 'linen', '2000000000077', 'LIN-BLK-M'])('leaves %j to the till', (text) => {
    expect(isReceiptEntry(text)).toBe(false);
  });
});
