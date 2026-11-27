/** Turns an approved void into the `SALE_VOIDED` event. Synchronous, for the commit. */
import { SCHEMA_VERSION, type SaleVoidedEvent, saleVoidedEventSchema } from '@pos/core';
import { v7 as uuidv7 } from 'uuid';

import { toSnapshot } from '../checkout/storable-text';
import type { SaleRow } from '../db/types';
import { REASON_MAX_LENGTH } from './build-return';
import { VoidRefusedError } from './void-error';

export interface VoidRequest {
  /** Optional: blank means none. */
  reason: string;
  /** The manager who approved it. */
  staffId: string;
}

export interface VoidContext {
  terminalId: string;
  seq: number;
  occurredAt: string;
}

export function buildVoidEvent(
  sale: SaleRow,
  { reason, staffId }: VoidRequest,
  { terminalId, seq, occurredAt }: VoidContext,
): SaleVoidedEvent {
  const event = saleVoidedEventSchema.safeParse({
    eventId: uuidv7(),
    terminalId,
    seq,
    type: 'SALE_VOIDED',
    schemaVersion: SCHEMA_VERSION,
    occurredAt,
    payload: {
      saleId: sale.id,
      receiptNo: sale.receiptNo,
      staffId,
      reason: toSnapshot(reason.trim(), REASON_MAX_LENGTH) || null,
    },
  });
  // The last gate: an event the server would reject must never reach the outbox.
  if (!event.success) {
    const fields = event.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new VoidRefusedError('INVALID_VOID', fields);
  }
  return event.data;
}
