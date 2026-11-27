/**
 * Sends the outbox in `seq` order until it is empty (ARCH §4.4). Run it only while holding the sync
 * lock. The network is used between transactions, never inside one (CLAUDE.md rule 4).
 */
import { readBatchFrom, readPendingBatch, toSyncEvent } from '../db/outbox-repo';
import { getSetting } from '../db/settings-repo';
import type { HaltReason } from '../db/types';
import { ApiRequestError } from './api-client';
import { applyPushResponse } from './apply-push';
import { classifyFailure } from './classify-failure';
import type { SyncDeps } from './sync-deps';

export type PushOutcome =
  /** Nothing is left to send. `sent` counts the events the server answered. */
  { status: 'drained'; sent: number; failed: number } | { status: 'halted'; reason: HaltReason };

export interface PushDeps extends SyncDeps {
  now?: () => Date;
}

/** Reads the identity and the next batch together; `from` is set while resending after a 409. */
function readNext({ database }: PushDeps, from: number | null) {
  const { settings, outbox } = database;
  return database.transaction('r', settings, outbox, async () => ({
    apiUrl: await getSetting(database, 'apiUrl'),
    token: await getSetting(database, 'deviceToken'),
    terminalId: await getSetting(database, 'terminalId'),
    rows: await (from === null ? readPendingBatch(database) : readBatchFrom(database, from)),
  }));
}

/** Throws on failures worth retrying, leaving unanswered events pending. */
export async function pushPending(deps: PushDeps): Promise<PushOutcome> {
  const { database, createClient, now } = deps;
  /** Where to read from while resending; `null` for the pending events. */
  let from: number | null = null;
  /** The seq the server just asked for, which the next batch has to start with. */
  let wanted: number | null = null;
  let lastGap = 0;
  let sent = 0;
  let failed = 0;

  for (;;) {
    const { apiUrl, token, terminalId, rows } = await readNext(deps, from);
    if (!apiUrl || !token || !terminalId) throw new Error('This terminal is not enrolled');

    // The event is gone or was rejected: the server can never have what it asks for.
    if (wanted !== null && rows[0]?.seq !== wanted) return { status: 'halted', reason: 'SEQ_GAP' };
    if (rows.length === 0) {
      if (from === null) return { status: 'drained', sent, failed };
      from = null;
      continue;
    }

    let response;
    try {
      response = await createClient(apiUrl).push(token, {
        terminalId,
        events: rows.map(toSyncEvent),
      });
    } catch (error) {
      const gap = error instanceof ApiRequestError ? error.expectedSeq : null;
      if (gap !== null) {
        // Each resend must get further than the last, or this would never end.
        if (gap <= lastGap) return { status: 'halted', reason: 'SEQ_GAP' };
        from = wanted = lastGap = gap;
        continue;
      }
      const action = classifyFailure(error);
      if (action.kind === 'halt') return { status: 'halted', reason: action.reason };
      throw error;
    }

    wanted = null;
    const applied = await applyPushResponse(database, rows, response, { now });
    if (applied.seqReused) return { status: 'halted', reason: 'SEQ_REUSED' };
    // Sending the same batch again at once would only repeat this.
    if (applied.answered === 0) throw new Error('The server answered no event of the batch');
    sent += applied.answered;
    failed += applied.failed;
    if (from !== null) from = rows[rows.length - 1]!.seq + 1;
  }
}
