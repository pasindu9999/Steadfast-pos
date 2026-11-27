/**
 * Turns a quoted return into the `RETURN_COMPLETED` event. Synchronous, so it can run inside the
 * commit transaction.
 */
import {
  type PullStore,
  returnCompletedEventSchema,
  type ReturnCompletedEvent,
  SCHEMA_VERSION,
  type TenderMethod,
} from '@pos/core';
import { v7 as uuidv7 } from 'uuid';

import { toSnapshot } from '../checkout/storable-text';
import { checkCard } from '../checkout/tender';
import { ReturnRefusedError } from './return-error';
import type { ReturnQuote } from './return-quote';

/** The contract's limit (`@pos/core`). */
export const REASON_MAX_LENGTH = 500;

export interface ReturnRequest {
  originalSaleId: string;
  reason: string;
  method: TenderMethod;
  /** The EFTPOS reference of a card refund. */
  cardReference: string | null;
  staffId: string | null;
}

export interface ReturnContext {
  terminalId: string;
  returnNo: string;
  store: PullStore;
  seq: number;
  occurredAt: string;
}

function refundReference({ method, cardReference }: ReturnRequest): string | null {
  if (method !== 'card') return null;
  const checked = checkCard(cardReference ?? '', '');
  if ('field' in checked) throw new ReturnRefusedError('INVALID_RETURN', 'card reference');
  return checked.cardReference;
}

export function buildReturnEvent(
  quote: ReturnQuote,
  request: ReturnRequest,
  { terminalId, returnNo, store, seq, occurredAt }: ReturnContext,
): ReturnCompletedEvent {
  const reason = toSnapshot(request.reason.trim(), REASON_MAX_LENGTH);
  if (reason === '') throw new ReturnRefusedError('REASON_REQUIRED');

  const event = returnCompletedEventSchema.safeParse({
    eventId: uuidv7(),
    terminalId,
    seq,
    type: 'RETURN_COMPLETED',
    schemaVersion: SCHEMA_VERSION,
    occurredAt,
    payload: {
      returnId: uuidv7(),
      returnNo,
      originalSaleId: request.originalSaleId,
      storeId: store.id,
      staffId: request.staffId,
      reason,
      refundTotalCents: quote.refundTotalCents,
      roundingCents: quote.roundingCents,
      lines: quote.lines.map(({ saleLineNo, variantId, qty, refundCents, restock }) => ({
        returnLineId: uuidv7(),
        saleLineNo,
        variantId,
        qty,
        refundCents,
        restock,
      })),
      refunds: [
        {
          refundId: uuidv7(),
          method: request.method,
          amountCents: quote.refundAmountCents,
          cardReference: refundReference(request),
        },
      ],
    },
  });
  // The last gate: an event the server would reject must never reach the outbox.
  if (!event.success) {
    const fields = event.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new ReturnRefusedError('INVALID_RETURN', fields);
  }
  return event.data;
}
