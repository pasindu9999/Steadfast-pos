import { decodeReceiptQr } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { cart, cartLine, LINEN_ID, TEE_ID } from '../test/checkout-fixtures';
import {
  makeSale,
  OTHER_RECEIPT_NO,
  OTHER_SALE_ID,
  otherTerminalQr,
  recordReturnRows,
} from '../test/return-fixtures';
import { seedShop } from '../test/shop';
import { loadReturnable } from './load-returnable';

const qrRef = (text = otherTerminalQr()) => ({ kind: 'qr' as const, qr: decodeReceiptQr(text)! });

describe('loadReturnable: a sale made here', () => {
  it('shows what was sold, what was paid for each line and how', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(
      database,
      cart({
        lines: [
          cartLine({ qty: 3 }),
          cartLine({ variantId: TEE_ID, sku: 'TEE', name: 'Summer Tee', unitPriceCents: 3500 }),
        ],
        cartDiscount: { type: 'percent', value: 10 },
      }),
      { method: 'card' },
    );
    const ref = { kind: 'local' as const, saleId: sale.id };

    await expect(loadReturnable(database, ref)).resolves.toEqual({
      ref,
      saleId: sale.id,
      receiptNo: 'S01-T1-000001',
      onRecord: true,
      status: 'completed',
      occurredAt: sale.occurredAt,
      tender: 'card',
      totalCents: 27_180,
      lines: [
        {
          lineNo: 1,
          variantId: LINEN_ID,
          name: 'Linen Shirt — Black / M',
          soldQty: 3,
          returnedQty: 0,
          // Net of the cart discount allocated to the line.
          lineTotalCents: 24_030,
        },
        {
          lineNo: 2,
          variantId: TEE_ID,
          name: 'Summer Tee',
          soldQty: 1,
          returnedQty: 0,
          lineTotalCents: 3150,
        },
      ],
    });
  });

  it('adds up every return made here, sent or not', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);
    await recordReturnRows(database, sale.id, [[1, 1]]);
    await recordReturnRows(database, sale.id, [[1, 1]]);
    // Another sale's return counts for nothing here.
    await recordReturnRows(database, OTHER_SALE_ID, [[1, 1]]);

    const found = await loadReturnable(database, { kind: 'local', saleId: sale.id });

    expect(found?.lines[0]).toMatchObject({ soldQty: 3, returnedQty: 2 });
  });

  it('prefers the stored sale to what a code says', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(database);
    const forged = otherTerminalQr({
      saleId: sale.id,
      receiptNo: sale.receiptNo,
      lines: [{ lineNo: 1, variantId: LINEN_ID, qty: 99, lineTotalCents: 999_900 }],
    });

    const found = await loadReturnable(database, qrRef(forged));

    expect(found).toMatchObject({ onRecord: true, tender: 'cash' });
    expect(found?.lines[0]).toMatchObject({ soldQty: 3, lineTotalCents: 26_700 });
  });

  it('is null for a sale that is not stored', async () => {
    const database = await seedShop();

    await expect(
      loadReturnable(database, { kind: 'local', saleId: OTHER_SALE_ID }),
    ).resolves.toBeNull();
  });
});

describe('loadReturnable: a sale only the receipt knows', () => {
  it('takes the quantities and amounts from the code and the names from the catalogue', async () => {
    const database = await seedShop();
    const ref = qrRef(
      otherTerminalQr({
        lines: [
          { lineNo: 1, variantId: LINEN_ID, qty: 2, lineTotalCents: 17_800 },
          { lineNo: 2, variantId: TEE_ID, qty: 1, lineTotalCents: 3500 },
        ],
      }),
    );

    await expect(loadReturnable(database, ref)).resolves.toEqual({
      ref,
      saleId: OTHER_SALE_ID,
      receiptNo: OTHER_RECEIPT_NO,
      onRecord: false,
      status: 'completed',
      occurredAt: null,
      tender: null,
      totalCents: null,
      lines: [
        {
          lineNo: 1,
          variantId: LINEN_ID,
          name: 'Linen Shirt — Black / M',
          soldQty: 2,
          returnedQty: 0,
          lineTotalCents: 17_800,
        },
        {
          lineNo: 2,
          variantId: TEE_ID,
          name: 'Summer Tee — Navy / L',
          soldQty: 1,
          returnedQty: 0,
          lineTotalCents: 3500,
        },
      ],
    });
  });

  it('counts the returns already made here, never past the quantity in the code', async () => {
    const database = await seedShop();
    await recordReturnRows(database, OTHER_SALE_ID, [[1, 1]]);

    expect((await loadReturnable(database, qrRef()))?.lines[0]).toMatchObject({ returnedQty: 1 });

    await recordReturnRows(database, OTHER_SALE_ID, [[1, 5]]);

    expect((await loadReturnable(database, qrRef()))?.lines[0]).toMatchObject({ returnedQty: 2 });
  });

  it('names an archived item, and says when it does not know one', async () => {
    const database = await seedShop();
    await database.variants.update(LINEN_ID, { isActive: false });
    const unknown = '99999999-9999-4999-8999-999999999999';
    const ref = qrRef(
      otherTerminalQr({
        lines: [
          { lineNo: 1, variantId: LINEN_ID, qty: 1, lineTotalCents: 8900 },
          { lineNo: 2, variantId: unknown, qty: 1, lineTotalCents: 100 },
        ],
      }),
    );

    const found = await loadReturnable(database, ref);

    expect(found?.lines.map((line) => line.name)).toEqual([
      'Linen Shirt — Black / M',
      'Unknown item',
    ]);
  });
});
