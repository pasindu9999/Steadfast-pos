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

/** The event exactly as it was committed, without the local fields. */
export function toSyncEvent(row: OutboxRow): SyncEvent {
  const event: SyncEvent & Partial<Pick<OutboxRow, 'status' | 'error'>> = { ...row };
  delete event.status;
  delete event.error;
  return event;
}
