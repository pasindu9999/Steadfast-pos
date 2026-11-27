/** Everything a return receipt shows, read from this terminal's database only (ARCH §7.5). */
import type { PullStore } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { getSetting } from '../db/settings-repo';
import type { ReturnLineRow, ReturnRow } from '../db/types';

export interface ReturnReceiptData {
  returned: ReturnRow;
  /** In the order of the sale's lines. */
  lines: ReturnLineRow[];
  cashierName: string | null;
  store: PullStore;
}

/** `null` if this terminal has no such return. */
export function loadReturnReceipt(
  database: PosDatabase,
  returnId: string,
): Promise<ReturnReceiptData | null> {
  const { returns, returnLines, staff, settings } = database;

  return database.transaction('r', [returns, returnLines, staff, settings], async () => {
    const returned = await returns.get(returnId);
    if (!returned) return null;
    const lines = await returnLines.where('returnId').equals(returnId).sortBy('saleLineNo');
    const store = await getSetting(database, 'store');
    if (!store) return null;
    const cashier = returned.staffId === null ? undefined : await staff.get(returned.staffId);
    return { returned, lines, cashierName: cashier?.name ?? null, store };
  });
}
