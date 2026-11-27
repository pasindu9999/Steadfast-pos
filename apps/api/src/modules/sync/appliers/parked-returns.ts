import { returnCompletedPayloadSchema } from '@pos/core';

import { describeIssue } from '../../../common/zod-validation.pipe.js';
import { type ApplyContext, type ApplyOutcome, rejected, type ReleasedEvent } from './applier.js';
import { applyReturnCompleted } from './return-completed.js';

interface ParkedRow {
  eventId: string;
  terminalId: string;
  seq: bigint;
  occurredAt: Date;
  payload: unknown;
}

export async function applyParkedReturns(
  sale: ApplyContext,
  saleId: string,
): Promise<ReleasedEvent[]> {
  const { tx, stock } = sale;
  // Raw SQL: only this form of the JSON lookup uses the index on parked events (ARCH §4.4 step 7).
  const parked = await tx.$queryRaw<ParkedRow[]>`
    SELECT event_id AS "eventId", terminal_id AS "terminalId", seq,
           occurred_at AS "occurredAt", payload
    FROM sync_inbox
    WHERE status = 'parked' AND payload ->> 'originalSaleId' = ${saleId}
    ORDER BY received_at, seq`;

  const released: ReleasedEvent[] = [];
  for (const { eventId, terminalId, seq, occurredAt, payload } of parked) {
    const { store, ...terminal } = await tx.terminal.findUniqueOrThrow({
      where: { id: terminalId },
      select: { id: true, code: true, storeId: true, store: { select: { code: true } } },
    });
    const parsed = returnCompletedPayloadSchema.safeParse(payload);
    const outcome: ApplyOutcome = parsed.success
      ? await applyReturnCompleted(
          { tx, stock, occurredAt, terminal: { ...terminal, storeCode: store.code } },
          parsed.data,
        )
      : rejected('INVALID_PAYLOAD', describeIssue(parsed.error));

    const status = outcome.status === 'rejected' ? 'rejected' : 'applied';
    const refusal = outcome.status === 'rejected' ? outcome : null;
    await tx.syncInbox.update({
      where: { eventId },
      data: {
        status,
        error: refusal && `${refusal.code}: ${refusal.message}`,
        appliedAt: refusal ? null : new Date(),
      },
    });
    released.push({ eventId, terminalId, seq: Number(seq), status, code: refusal?.code });
  }
  return released;
}
