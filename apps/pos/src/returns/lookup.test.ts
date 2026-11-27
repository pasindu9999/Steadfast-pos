import { decodeReceiptQr } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { makeSale, OTHER_RECEIPT_NO, otherTerminalQr } from '../test/return-fixtures';
import { seedShop } from '../test/shop';
import { findSale } from './lookup';

describe('findSale', () => {
  it('finds a sale of this terminal by its receipt number, however it is typed', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);

    await expect(findSale(database, ' s01-t1-000001 ')).resolves.toEqual({
      status: 'found',
      ref: { kind: 'local', saleId: sale.id },
    });
  });

  it('opens the stored sale when its own receipt code is read', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);
    const text = otherTerminalQr({ saleId: sale.id, receiptNo: sale.receiptNo });

    await expect(findSale(database, text)).resolves.toEqual({
      status: 'found',
      ref: { kind: 'local', saleId: sale.id },
    });
  });

  it('takes a sale this terminal has never stored from its receipt code', async () => {
    const database = await seedShop();
    const text = otherTerminalQr();

    await expect(findSale(database, text)).resolves.toEqual({
      status: 'found',
      ref: { kind: 'qr', qr: decodeReceiptQr(text) },
    });
  });

  it('cannot find another terminal’s sale by number alone', async () => {
    const database = await seedShop();

    await expect(findSale(database, OTHER_RECEIPT_NO)).resolves.toEqual({
      status: 'not_on_terminal',
      receiptNo: OTHER_RECEIPT_NO,
    });
  });

  it.each([
    ['number', 'S02-T1-000001'],
    ['code', otherTerminalQr({ receiptNo: 'S02-T1-000001' })],
  ])('refuses another store’s receipt %s', async (_, text) => {
    const database = await seedShop();

    await expect(findSale(database, text)).resolves.toEqual({
      status: 'other_store',
      receiptNo: 'S02-T1-000001',
    });
  });

  it('refuses a code that gives a stored receipt number to another sale', async () => {
    const database = await seedShop();
    await makeSale(database);
    const forged = otherTerminalQr({ receiptNo: 'S01-T1-000001' });

    await expect(findSale(database, forged)).resolves.toEqual({ status: 'invalid_qr' });
  });

  it.each([
    ['{"cut', 'invalid_qr'],
    ['R-S01-T1-000001', 'return_no'],
    ['linen shirt', 'unrecognised'],
    ['', 'empty'],
  ])('answers %j with %s', async (text, status) => {
    const database = await seedShop();

    await expect(findSale(database, text)).resolves.toEqual({ status });
  });
});
