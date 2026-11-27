/**
 * The void commit (ARCH §7.4): the sale's new status, the stock put back, the counter and the outbox
 * event are written in one transaction, or not at all. Nothing here uses the network.
 */
import { v7 as uuidv7 } from 'uuid';

import { db, type PosDatabase } from '../db/database';
import { putSettings } from '../db/settings-repo';
import { readTerminalIdentity } from '../db/terminal-identity';
import type { SaleRow, StockMovementRow } from '../db/types';
import { isManager, type LoginStaff } from '../staff/staff-pin';
import { buildVoidEvent } from './build-void';
import { VoidRefusedError } from './void-error';
import { voidRefusal } from './void-rules';

export interface VoidDraft {
  saleId: string;
  reason: string;
  /** The manager whose PIN was checked. Every void needs one. */
  approval: LoginStaff | null;
}

export interface VoidOptions {
  database?: PosDatabase;
  now?: () => Date;
}

export interface CommittedVoid {
  sale: SaleRow;
  eventId: string;
  seq: number;
}

/**
 * Reads what decides whether a sale can be voided. Must run inside a transaction covering
 * `settings`, `sales` and `returns`. `undefined` until the first pull.
 */
export async function readVoidState(database: PosDatabase, saleId: string, now: Date) {
  const terminal = await readTerminalIdentity(database);
  if (!terminal) return undefined;
  const sale = await database.sales.get(saleId);
  const returned = await database.returns.where('originalSaleId').equals(saleId).count();
  const refusal = voidRefusal({
    sale,
    terminalId: terminal.terminalId,
    hasReturns: returned > 0,
    now,
    timeZone: terminal.store.timezone,
  });
  return { terminal, sale, refusal };
}

/** `readVoidState` in its own transaction, for the screen. */
export function loadVoidState(database: PosDatabase, saleId: string, now: Date) {
  const { settings, sales, returns } = database;
  // `async`, or Dexie may not keep the transaction open across the awaits.
  return database.transaction('r', [settings, sales, returns], async () =>
    readVoidState(database, saleId, now),
  );
}

/** Voids a sale of today. Only Dexie may be awaited inside the transaction (CLAUDE.md rule 4). */
export function commitVoid(
  draft: VoidDraft,
  { database = db, now = () => new Date() }: VoidOptions = {},
): Promise<CommittedVoid> {
  const { settings, staff, sales, saleLines, returns, stockMovements, outbox } = database;

  return database.transaction(
    'rw',
    [settings, staff, sales, saleLines, returns, stockMovements, outbox],
    async () => {
      const at = now();
      const state = await readVoidState(database, draft.saleId, at);
      if (!state) throw new VoidRefusedError('NOT_READY');
      const { terminal, sale, refusal } = state;
      // A sale that is not stored is always refused; the check tells TypeScript.
      if (refusal || !sale) throw new VoidRefusedError(refusal ?? 'OTHER_TERMINAL');
      const { approval } = draft;
      if (!approval || !(await isManager(database, approval))) {
        throw new VoidRefusedError('APPROVAL_REQUIRED');
      }

      const seq = terminal.outboxSeq + 1;
      const event = buildVoidEvent(
        sale,
        { reason: draft.reason, staffId: approval.id },
        { terminalId: terminal.terminalId, seq, occurredAt: at.toISOString() },
      );
      const { occurredAt, eventId } = event;
      const voided: SaleRow = {
        ...sale,
        status: 'voided',
        voidedAt: occurredAt,
        voidReason: event.payload.reason,
      };
      const lines = await saleLines.where('saleId').equals(sale.id).toArray();
      const movements: StockMovementRow[] = lines.map((line) => ({
        id: uuidv7(),
        variantId: line.variantId,
        delta: line.qty,
        reason: 'void',
        sourceType: 'sale',
        sourceId: sale.id,
        seq,
        synced: 0,
        occurredAt,
      }));

      await putSettings(database, { outboxSeq: seq });
      await sales.put(voided);
      await stockMovements.bulkAdd(movements);
      await outbox.add({ ...event, status: 'pending' });

      return { sale: voided, eventId, seq };
    },
  );
}
