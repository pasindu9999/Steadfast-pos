/**
 * The checkout commit (ARCH §4.2): counters, sale, lines, payment, stock movements and the outbox
 * event are written in one transaction, or not at all. Nothing here uses the network.
 */
import { formatReceiptNo } from '@pos/core';
import { v7 as uuidv7 } from 'uuid';

import { db, type PosDatabase } from '../db/database';
import { getSetting, putSettings } from '../db/settings-repo';
import { readTerminalIdentity } from '../db/terminal-identity';
import type { PaymentRow, SaleLineRow, SaleRow, StockMovementRow } from '../db/types';
import { buildSaleEvent } from './build-sale';
import { CheckoutError } from './checkout-error';
import type { SaleDraft, TenderInput } from './sale-draft';

export interface CommitOptions {
  database?: PosDatabase;
  now?: () => Date;
}

/** What the receipt and the change screen need. */
export interface CommittedSale {
  sale: SaleRow;
  lines: SaleLineRow[];
  payment: PaymentRow;
  eventId: string;
  seq: number;
}

/** Reads the identity and counters. Must run inside the commit transaction. */
async function readTerminal(database: PosDatabase) {
  const identity = await readTerminalIdentity(database);
  const receiptSeq = await getSetting(database, 'receiptSeq');
  if (!identity || receiptSeq === undefined) throw new CheckoutError('NOT_READY');
  return { ...identity, receiptSeq };
}

/**
 * Commits a paid sale. Call it once per payment: a second call is a second sale.
 * Only Dexie may be awaited inside the transaction (CLAUDE.md rule 4).
 */
export function commitSale(
  cart: SaleDraft,
  tender: TenderInput,
  { database = db, now = () => new Date() }: CommitOptions = {},
): Promise<CommittedSale> {
  const { settings, sales, saleLines, payments, stockMovements, outbox } = database;

  return database.transaction(
    'rw',
    [settings, sales, saleLines, payments, stockMovements, outbox],
    async () => {
      const terminal = await readTerminal(database);
      // Numbers come from the counters, inside this transaction, so a failure uses none.
      const receiptSeq = terminal.receiptSeq + 1;
      const seq = terminal.outboxSeq + 1;
      const event = buildSaleEvent(cart, tender, {
        terminalId: terminal.terminalId,
        receiptNo: formatReceiptNo({
          storeCode: terminal.store.code,
          terminalCode: terminal.terminalCode,
          seq: receiptSeq,
        }),
        store: terminal.store,
        seq,
        occurredAt: now().toISOString(),
      });

      const { saleId, lines, payments: paid, ...header } = event.payload;
      const { occurredAt, terminalId, eventId } = event;
      const sale: SaleRow = {
        ...header,
        id: saleId,
        terminalId,
        status: 'completed',
        occurredAt,
      };
      const lineRows: SaleLineRow[] = lines.map(({ lineId, ...line }) => ({
        ...line,
        id: lineId,
        saleId,
      }));
      const paymentRows: PaymentRow[] = paid.map(({ paymentId, ...payment }) => ({
        ...payment,
        id: paymentId,
        saleId,
      }));
      const movements: StockMovementRow[] = lines.map((line) => ({
        id: uuidv7(),
        variantId: line.variantId,
        delta: -line.qty,
        reason: 'sale',
        sourceType: 'sale',
        sourceId: saleId,
        seq,
        synced: 0,
        occurredAt,
      }));

      await putSettings(database, { receiptSeq, outboxSeq: seq });
      await sales.add(sale);
      await saleLines.bulkAdd(lineRows);
      await payments.bulkAdd(paymentRows);
      await stockMovements.bulkAdd(movements);
      await outbox.add({ ...event, status: 'pending' });

      // One tender per sale in this version (ARCH §14).
      return { sale, lines: lineRows, payment: paymentRows[0]!, eventId, seq };
    },
  );
}
