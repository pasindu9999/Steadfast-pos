/** Finds the sale to return, from this terminal's database or the receipt itself (ARCH §7.4). */
import { parseReceiptNo } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { getSetting } from '../db/settings-repo';
import type { SaleRef } from './load-returnable';
import { parseLookup } from './parse-lookup';

export type LookupResult =
  | { status: 'found'; ref: SaleRef }
  /** A receipt number alone says nothing about a sale made elsewhere. */
  | { status: 'not_on_terminal'; receiptNo: string }
  | { status: 'other_store'; receiptNo: string }
  | { status: 'empty' | 'invalid_qr' | 'return_no' | 'unrecognised' };

export async function findSale(database: PosDatabase, text: string): Promise<LookupResult> {
  const parsed = parseLookup(text);
  if (parsed.type !== 'receipt_no' && parsed.type !== 'qr') return { status: parsed.type };

  const { sales, settings } = database;
  return database.transaction('r', sales, settings, async (): Promise<LookupResult> => {
    const receiptNo = parsed.type === 'qr' ? parsed.qr.receiptNo : parsed.receiptNo;
    const numbered = await sales.where('receiptNo').equals(receiptNo).first();

    if (parsed.type === 'qr') {
      const { saleId } = parsed.qr;
      if (await sales.get(saleId)) return { status: 'found', ref: { kind: 'local', saleId } };
      // Receipt numbers are never shared, so a code that reuses one was not printed here.
      if (numbered) return { status: 'invalid_qr' };
    } else if (numbered) {
      return { status: 'found', ref: { kind: 'local', saleId: numbered.id } };
    }

    const store = await getSetting(database, 'store');
    if (parseReceiptNo(receiptNo)?.storeCode !== store?.code) {
      return { status: 'other_store', receiptNo };
    }
    return parsed.type === 'qr'
      ? { status: 'found', ref: { kind: 'qr', qr: parsed.qr } }
      : { status: 'not_on_terminal', receiptNo };
  });
}
