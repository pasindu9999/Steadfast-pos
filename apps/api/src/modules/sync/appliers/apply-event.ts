import type { SyncEvent } from '@pos/core';

import type { Prisma } from '../../../generated/prisma/client.js';
import { StockChanges } from '../../inventory/stock-changes.js';
import type { AuthenticatedTerminal } from '../../terminals/device-auth.guard.js';
import type { ApplyContext, ApplyOutcome } from './applier.js';
import { applyReturnCompleted } from './return-completed.js';
import { applySaleCompleted } from './sale-completed.js';
import { applySaleVoided } from './sale-voided.js';

function dispatch(context: ApplyContext, event: SyncEvent): Promise<ApplyOutcome> {
  switch (event.type) {
    case 'SALE_COMPLETED':
      return applySaleCompleted(context, event.payload);
    case 'SALE_VOIDED':
      return applySaleVoided(context, event.payload);
    case 'RETURN_COMPLETED':
      return applyReturnCompleted(context, event.payload);
    default: {
      const unhandled: never = event;
      throw new Error(`unhandled event: ${JSON.stringify(unhandled)}`);
    }
  }
}

export async function applyEvent(
  tx: Prisma.TransactionClient,
  terminal: AuthenticatedTerminal,
  event: SyncEvent,
): Promise<ApplyOutcome> {
  const stock = new StockChanges();
  const outcome = await dispatch(
    { tx, terminal, occurredAt: new Date(event.occurredAt), stock },
    event,
  );
  await stock.apply(tx, event.eventId);
  return outcome;
}
