/** Reading the outbox for sending (ARCH §4.4). `seq` is the primary key, so rows come in order. */
import { PUSH_BATCH_MAX, type SyncEvent } from '@pos/core';

import type { PosDatabase } from './database';
import type { OutboxRow } from './types';

/** The oldest unsent events. */
export function readPendingBatch(
  database: PosDatabase,
  limit = PUSH_BATCH_MAX,
): Promise<OutboxRow[]> {
  return database.outbox.where('status').equals('pending').limit(limit).toArray();
}

/**
 * Events from `seq` on, including those already marked synced, for a server that asks for them
 * again. A rejected event is never sent again.
 */
export function readBatchFrom(
  database: PosDatabase,
  seq: number,
  limit = PUSH_BATCH_MAX,
): Promise<OutboxRow[]> {
  return database.outbox
    .where('seq')
    .aboveOrEqual(seq)
    .filter((row) => row.status !== 'failed')
    .limit(limit)
    .toArray();
}

/** A receipt the server refused, as the cashier would look for it. */
export interface FailedReceipt {
  seq: number;
  /** The receipt or return number. */
  number: string;
  /** The server's rejection code. */
  code: string | null;
}

export interface OutboxSummary {
  pending: number;
  oldestPendingAt: string | null;
  failed: FailedReceipt[];
}

function documentNumber(event: SyncEvent): string {
  switch (event.type) {
    case 'SALE_COMPLETED':
    case 'SALE_VOIDED':
      return event.payload.receiptNo;
    case 'RETURN_COMPLETED':
      return event.payload.returnNo;
    default: {
      const unhandled: never = event;
      return unhandled;
    }
  }
}

/** What the sync badge shows about the outbox (ARCH §4.8). */
export function getOutboxSummary(database: PosDatabase): Promise<OutboxSummary> {
  const { outbox } = database;
  return database.transaction('r', outbox, async () => {
    const waiting = outbox.where('status').equals('pending');
    const [pending, oldest, failed] = await Promise.all([
      waiting.count(),
      // The lowest seq.
      outbox.where('status').equals('pending').first(),
      outbox.where('status').equals('failed').toArray(),
    ]);
    return {
      pending,
      oldestPendingAt: oldest?.occurredAt ?? null,
      failed: failed.map((row) => ({
        seq: row.seq,
        number: documentNumber(row),
        code: row.error?.code ?? null,
      })),
    };
  });
}

/** The event exactly as it was committed, without the local fields. */
export function toSyncEvent(row: OutboxRow): SyncEvent {
  const event: SyncEvent & Partial<Pick<OutboxRow, 'status' | 'error'>> = { ...row };
  delete event.status;
  delete event.error;
  return event;
}
