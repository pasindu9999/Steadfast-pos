/** Sales to return: one made here, one only known from the other terminal's receipt. */
import { encodeReceiptQr, type ReceiptQrSale } from '@pos/core';
import { v7 as uuidv7 } from 'uuid';

import { commitSale } from '../checkout/commit-sale';
import type { SaleDraft, TenderInput } from '../checkout/sale-draft';
import type { PosDatabase } from '../db/database';
import { cart, cartLine, LINEN_ID } from './checkout-fixtures';

export const OTHER_SALE_ID = '01920f3a-7b2c-7000-8000-0000000000aa';
export const OTHER_RECEIPT_NO = 'S01-T2-000042';

/** The text in the code on a receipt from terminal T2, by default for two shirts. */
export function otherTerminalQr(fields: Partial<ReceiptQrSale> = {}): string {
  return encodeReceiptQr({
    saleId: OTHER_SALE_ID,
    receiptNo: OTHER_RECEIPT_NO,
    lines: [{ lineNo: 1, variantId: LINEN_ID, qty: 2, lineTotalCents: 17_800 }],
    ...fields,
  });
}

/** A paid sale on this terminal, by default of three shirts for cash. */
export function makeSale(
  database: PosDatabase,
  draft: SaleDraft = cart({ lines: [cartLine({ qty: 3 })] }),
  tender: TenderInput = { method: 'cash', tenderedCents: 100_000 },
  now?: () => Date,
) {
  return commitSale(draft, tender, { database, now });
}

/** Writes a return's rows directly, as far as reading them back needs. */
export async function recordReturnRows(
  database: PosDatabase,
  originalSaleId: string,
  lines: [saleLineNo: number, qty: number][],
): Promise<void> {
  const id = uuidv7();
  const number = (await database.returns.count()) + 1;
  await database.returns.add({
    id,
    returnNo: `R-S01-T1-${String(number).padStart(6, '0')}`,
    originalSaleId,
    storeId: '11111111-1111-4111-8111-111111111111',
    terminalId: '22222222-2222-4222-8222-222222222222',
    staffId: null,
    reason: 'Wrong size',
    refundTotalCents: 0,
    roundingCents: 0,
    refunds: [],
    occurredAt: new Date().toISOString(),
  });
  await database.returnLines.bulkAdd(
    lines.map(([saleLineNo, qty]) => ({
      id: uuidv7(),
      returnId: id,
      saleLineNo,
      variantId: LINEN_ID,
      qty,
      refundCents: 0,
      restock: true,
    })),
  );
}
