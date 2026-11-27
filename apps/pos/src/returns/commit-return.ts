/**
 * The return commit (ARCH §7.4): counters, return, lines, refund, restock movements and the outbox
 * event are written in one transaction, or not at all. Nothing here uses the network.
 */
import { formatReturnNo, type TenderMethod } from '@pos/core';
import { v7 as uuidv7 } from 'uuid';

import { db, type PosDatabase } from '../db/database';
import { getSetting, putSettings } from '../db/settings-repo';
import { readTerminalIdentity } from '../db/terminal-identity';
import type { ReturnLineRow, ReturnRow, StockMovementRow } from '../db/types';
import { isManager, type LoginStaff } from '../staff/staff-pin';
import { buildReturnEvent } from './build-return';
import { readReturnable, returnableTables, type SaleRef } from './load-returnable';
import { ReturnRefusedError } from './return-error';
import { quoteReturn, type ReturnQuote, type ReturnSelection } from './return-quote';

export interface ReturnDraft {
  ref: SaleRef;
  selections: readonly ReturnSelection[];
  reason: string;
  method: TenderMethod;
  cardReference: string | null;
  /** Who is serving. */
  staffId: string | null;
  /** The manager whose PIN was checked, when the return needs one. */
  approval: LoginStaff | null;
}

export interface CommitOptions {
  database?: PosDatabase;
  now?: () => Date;
}

/** What the return receipt needs. */
export interface CommittedReturn {
  return: ReturnRow;
  lines: ReturnLineRow[];
  eventId: string;
  seq: number;
}

/** Reads the identity and counters. Must run inside the commit transaction. */
async function readTerminal(database: PosDatabase) {
  const identity = await readTerminalIdentity(database);
  const returnSeq = await getSetting(database, 'returnSeq');
  if (!identity || returnSeq === undefined) throw new ReturnRefusedError('NOT_READY');
  return { ...identity, returnSeq };
}

function quote(...args: Parameters<typeof quoteReturn>): ReturnQuote {
  try {
    return quoteReturn(...args);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    const over = 'code' in error && error.code === 'OVER_RETURN';
    throw new ReturnRefusedError(over ? 'OVER_RETURN' : 'INVALID_RETURN', error.message);
  }
}

/**
 * Commits a return whose money is about to be handed back. Call it once per refund: a second call is
 * a second return. What is left to return is read again here, so it can't be exceeded however many
 * tabs ask. Only Dexie may be awaited inside the transaction (CLAUDE.md rule 4).
 */
export function commitReturn(
  draft: ReturnDraft,
  { database = db, now = () => new Date() }: CommitOptions = {},
): Promise<CommittedReturn> {
  const { settings, staff, returns, returnLines, stockMovements, outbox } = database;

  return database.transaction(
    'rw',
    [settings, staff, stockMovements, outbox, ...returnableTables(database)],
    async () => {
      const terminal = await readTerminal(database);
      const sale = await readReturnable(database, draft.ref);
      if (!sale) throw new ReturnRefusedError('SALE_NOT_FOUND');
      if (sale.status === 'voided') throw new ReturnRefusedError('SALE_VOIDED');

      const priced = quote(sale, draft.selections, draft.method, terminal.store.cashRoundingCents);
      if (priced.lines.length === 0) throw new ReturnRefusedError('NOTHING_SELECTED');
      // Checked against the staff as stored now, not as the caller describes them.
      if (priced.needsApproval && !(await isManager(database, draft.approval))) {
        throw new ReturnRefusedError('APPROVAL_REQUIRED');
      }

      // Numbers come from the counters, inside this transaction, so a failure uses none.
      const returnSeq = terminal.returnSeq + 1;
      const seq = terminal.outboxSeq + 1;
      const event = buildReturnEvent(
        priced,
        { ...draft, originalSaleId: sale.saleId },
        {
          terminalId: terminal.terminalId,
          returnNo: formatReturnNo({
            storeCode: terminal.store.code,
            terminalCode: terminal.terminalCode,
            seq: returnSeq,
          }),
          store: terminal.store,
          seq,
          occurredAt: now().toISOString(),
        },
      );

      const { returnId, lines, ...header } = event.payload;
      const { occurredAt, terminalId, eventId } = event;
      const returnRow: ReturnRow = {
        ...header,
        id: returnId,
        terminalId,
        occurredAt,
        originalReceiptNo: sale.receiptNo,
      };
      // The event's lines are the quoted ones, in the same order.
      const lineRows: ReturnLineRow[] = lines.map(({ returnLineId, ...line }, index) => ({
        ...line,
        id: returnLineId,
        returnId,
        nameSnapshot: priced.lines[index]!.name,
      }));
      const movements: StockMovementRow[] = lines
        .filter((line) => line.restock)
        .map((line) => ({
          id: uuidv7(),
          variantId: line.variantId,
          delta: line.qty,
          reason: 'return',
          sourceType: 'return',
          sourceId: returnId,
          seq,
          synced: 0,
          occurredAt,
        }));

      await putSettings(database, { returnSeq, outboxSeq: seq });
      await returns.add(returnRow);
      await returnLines.bulkAdd(lineRows);
      await stockMovements.bulkAdd(movements);
      await outbox.add({ ...event, status: 'pending' });

      return { return: returnRow, lines: lineRows, eventId, seq };
    },
  );
}
