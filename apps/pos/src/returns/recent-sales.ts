/** The latest sales made on this terminal, to pick one to return or void (ARCH §7.4). */
import type { TenderMethod } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { readReturnable, returnableTables } from './load-returnable';

export const RECENT_SALES_LIMIT = 20;

export interface RecentSale {
  saleId: string;
  receiptNo: string;
  occurredAt: string;
  totalCents: number;
  method: TenderMethod | null;
  voided: boolean;
  /** How much has been returned on this terminal. */
  returned: 'none' | 'part' | 'all';
}

export function listRecentSales(
  database: PosDatabase,
  limit = RECENT_SALES_LIMIT,
): Promise<RecentSale[]> {
  // One transaction, so the sales and their returns describe the same moment.
  return database.transaction('r', returnableTables(database), async () => {
    const sales = await database.sales.orderBy('occurredAt').reverse().limit(limit).toArray();
    return Promise.all(
      sales.map(async ({ id: saleId, receiptNo, occurredAt, totalCents, status }) => {
        const detail = await readReturnable(database, { kind: 'local', saleId });
        const lines = detail?.lines ?? [];
        const some = lines.some((line) => line.returnedQty > 0);
        const all = some && lines.every((line) => line.returnedQty === line.soldQty);
        return {
          saleId,
          receiptNo,
          occurredAt,
          totalCents,
          method: detail?.tender ?? null,
          voided: status === 'voided',
          returned: all ? ('all' as const) : some ? ('part' as const) : ('none' as const),
        };
      }),
    );
  });
}
