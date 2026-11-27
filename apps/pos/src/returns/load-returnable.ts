/**
 * A sale as far as this terminal knows it, with what can still come back from each line (ARCH §7.4).
 * It comes from the stored sale or, for one this terminal has never stored, from its receipt code.
 */
import { type ReceiptQr, receiptQrLines, type SaleStatus, type TenderMethod } from '@pos/core';

import { variantDisplayName } from '../catalog/display-name';
import type { PosDatabase } from '../db/database';
import type { SaleRow } from '../db/types';

/** Which sale is being returned: one stored here, or one read from a receipt. */
export type SaleRef = { kind: 'local'; saleId: string } | { kind: 'qr'; qr: ReceiptQr };

export interface ReturnableLine {
  lineNo: number;
  variantId: string;
  name: string;
  soldQty: number;
  /** Returned on this terminal, whether or not the server has it yet. */
  returnedQty: number;
  /** What the customer paid for the whole line. */
  lineTotalCents: number;
}

export interface ReturnableSale {
  ref: SaleRef;
  saleId: string;
  receiptNo: string;
  /** Whether this terminal stored the sale. If not, only the receipt code vouches for it. */
  onRecord: boolean;
  status: SaleStatus;
  /** A receipt code holds neither the time, how the sale was paid, nor its total. */
  occurredAt: string | null;
  tender: TenderMethod | null;
  totalCents: number | null;
  /** In line number order. */
  lines: ReturnableLine[];
}

export const UNKNOWN_ITEM_NAME = 'Unknown item';

type SoldLine = Omit<ReturnableLine, 'returnedQty'>;

/** The tables `readReturnable` needs in its transaction. */
export const returnableTables = (database: PosDatabase) => [
  database.sales,
  database.saleLines,
  database.payments,
  database.returns,
  database.returnLines,
  database.products,
  database.variants,
];

async function returnedByLine(database: PosDatabase, saleId: string) {
  const returnIds = await database.returns.where('originalSaleId').equals(saleId).primaryKeys();
  const lines = await database.returnLines.where('returnId').anyOf(returnIds).toArray();
  const returned = new Map<number, number>();
  for (const { saleLineNo, qty } of lines) {
    returned.set(saleLineNo, (returned.get(saleLineNo) ?? 0) + qty);
  }
  return returned;
}

async function storedLines(database: PosDatabase, saleId: string): Promise<SoldLine[]> {
  const lines = await database.saleLines.where('saleId').equals(saleId).sortBy('lineNo');
  return lines.map(({ lineNo, variantId, nameSnapshot, qty, lineTotalCents }) => ({
    lineNo,
    variantId,
    name: nameSnapshot,
    soldQty: qty,
    lineTotalCents,
  }));
}

/** Names come from the catalogue, which keeps retired items too. */
async function codeLines(database: PosDatabase, qr: ReceiptQr): Promise<SoldLine[]> {
  const lines = receiptQrLines(qr);
  const variants = await database.variants.bulkGet(lines.map((line) => line.variantId));
  const products = await database.products.bulkGet(
    variants.map((variant) => variant?.productId ?? ''),
  );
  return lines.map(({ lineNo, variantId, qty, lineTotalCents }, index) => {
    const variant = variants[index];
    const product = products[index];
    const name =
      variant && product
        ? variantDisplayName(product.name, variant.color, variant.size)
        : UNKNOWN_ITEM_NAME;
    return { lineNo, variantId, name, soldQty: qty, lineTotalCents };
  });
}

type SaleHeader = Omit<ReturnableSale, 'ref' | 'lines'>;

async function storedHeader(database: PosDatabase, sale: SaleRow): Promise<SaleHeader> {
  const payment = await database.payments.where('saleId').equals(sale.id).first();
  const { id: saleId, receiptNo, status, occurredAt, totalCents } = sale;
  return {
    saleId,
    receiptNo,
    onRecord: true,
    status,
    occurredAt,
    tender: payment?.method ?? null,
    totalCents,
  };
}

const codeHeader = ({ saleId, receiptNo }: ReceiptQr): SaleHeader => ({
  saleId,
  receiptNo,
  onRecord: false,
  status: 'completed',
  occurredAt: null,
  tender: null,
  totalCents: null,
});

/**
 * Must run inside a transaction that covers `returnableTables`. Only Dexie is awaited, so the return
 * commit can use it. A stored sale always wins over what a code says. `null` if neither exists.
 */
export async function readReturnable(
  database: PosDatabase,
  ref: SaleRef,
): Promise<ReturnableSale | null> {
  const saleId = ref.kind === 'local' ? ref.saleId : ref.qr.saleId;
  const stored = await database.sales.get(saleId);
  let header: SaleHeader;
  let sold: SoldLine[];
  if (stored) {
    header = await storedHeader(database, stored);
    sold = await storedLines(database, saleId);
  } else if (ref.kind === 'qr') {
    header = codeHeader(ref.qr);
    sold = await codeLines(database, ref.qr);
  } else {
    return null;
  }

  const returned = await returnedByLine(database, saleId);
  const lines = sold.map((line) => ({
    ...line,
    returnedQty: Math.min(returned.get(line.lineNo) ?? 0, line.soldQty),
  }));
  return { ref, ...header, lines };
}

export function loadReturnable(
  database: PosDatabase,
  ref: SaleRef,
): Promise<ReturnableSale | null> {
  return database.transaction('r', returnableTables(database), () => readReturnable(database, ref));
}
