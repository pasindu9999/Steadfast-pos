/** Everything a receipt shows, read from this terminal's database only (ARCH §7.5). */
import type { PullStore } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { getSetting } from '../db/settings-repo';
import type { PaymentRow, SaleLineRow, SaleRow } from '../db/types';

export interface ReceiptData {
  sale: SaleRow;
  /** In line number order. */
  lines: SaleLineRow[];
  payment: PaymentRow;
  cashierName: string | null;
  store: PullStore;
}

/** `null` if this terminal has no such sale. */
export function loadReceipt(database: PosDatabase, saleId: string): Promise<ReceiptData | null> {
  const { sales, saleLines, payments, staff, settings } = database;

  return database.transaction('r', [sales, saleLines, payments, staff, settings], async () => {
    const sale = await sales.get(saleId);
    if (!sale) return null;
    const lines = await saleLines.where('saleId').equals(saleId).sortBy('lineNo');
    const payment = await payments.where('saleId').equals(saleId).first();
    const store = await getSetting(database, 'store');
    if (!payment || !store) return null;
    const cashier = sale.staffId === null ? undefined : await staff.get(sale.staffId);
    return { sale, lines, payment, cashierName: cashier?.name ?? null, store };
  });
}
