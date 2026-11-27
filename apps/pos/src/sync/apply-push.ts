import type { PushResponse, PushResult } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { saveSyncHalt } from '../db/settings-repo';
import type { OutboxRow } from '../db/types';

export interface PushApplied {
  /** Events of the batch the server gave a final answer for. */
  answered: number;
  /** Events newly marked synced. */
  synced: number;
  /** Events newly marked failed. */
  failed: number;
  /** The server has used these numbers already: the terminal must be enrolled again. */
  seqReused: boolean;
}

export interface ApplyPushOptions {
  now?: () => Date;
}

interface Decision {
  row: OutboxRow;
  result: PushResult;
}

/**
 * Writes the answer to one push in a single transaction (ARCH §4.4): outbox statuses, their stock
 * movements and the server's stock levels change together, so nothing counts twice.
 */
export async function applyPushResponse(
  database: PosDatabase,
  batch: readonly OutboxRow[],
  response: PushResponse,
  { now = () => new Date() }: ApplyPushOptions = {},
): Promise<PushApplied> {
  const { outbox, stockMovements, inventory, settings } = database;
  const sent = new Map(batch.map((row) => [row.eventId, row]));
  const decisions: Decision[] = response.results.flatMap((result) => {
    const row = sent.get(result.eventId);
    return row ? [{ row, result }] : [];
  });

  const summary = await database.transaction(
    'rw',
    [outbox, stockMovements, inventory, settings],
    async () => {
      const applied: PushApplied = { answered: 0, synced: 0, failed: 0, seqReused: false };
      const acknowledged = new Set<number>();

      for (const { row, result } of decisions) {
        // Not stored by the server: it stays pending, so the sale is not lost (ARCH §4.4 step 3).
        if (result.error?.code === 'SEQ_REUSED') {
          applied.seqReused = true;
          continue;
        }
        applied.answered += 1;
        const current = await outbox.get(row.seq);
        if (!current || current.status === 'failed') continue;

        switch (result.status) {
          case 'applied':
          case 'duplicate':
          case 'parked':
            acknowledged.add(row.seq);
            if (current.status === 'pending') {
              await outbox.put({ ...current, status: 'synced' });
              applied.synced += 1;
            }
            break;
          case 'rejected':
            await outbox.put({ ...current, status: 'failed', error: result.error ?? undefined });
            applied.failed += 1;
            break;
          default: {
            const unhandled: never = result.status;
            return unhandled;
          }
        }
      }

      await stockMovements
        .where('synced')
        .equals(0)
        .and((movement) => acknowledged.has(movement.seq))
        .modify((movement) => {
          movement.synced = 1;
        });
      await inventory.bulkPut(
        response.inventory.map(({ variantId, onHand }) => ({ variantId, serverOnHand: onHand })),
      );
      if (applied.seqReused) await saveSyncHalt(database, 'SEQ_REUSED', now());
      return applied;
    },
  );

  for (const { row, result } of decisions) {
    const { eventId, terminalId, seq } = row;
    const { status, error } = result;
    console.info('sync event', { eventId, terminalId, seq, status, code: error?.code });
  }
  return summary;
}
