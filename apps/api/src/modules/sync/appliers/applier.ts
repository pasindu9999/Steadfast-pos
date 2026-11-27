import type { ErrorCode } from '@pos/core';

import type { Prisma } from '../../../generated/prisma/client.js';
import type { StockChanges } from '../../inventory/stock-changes.js';
import type { AuthenticatedTerminal } from '../../terminals/device-auth.guard.js';
import type { Rejection } from '../event-check.js';

export interface ApplyContext {
  tx: Prisma.TransactionClient;
  terminal: AuthenticatedTerminal;
  occurredAt: Date;
  stock: StockChanges;
}

export interface ReleasedEvent {
  eventId: string;
  terminalId: string;
  seq: number;
  status: 'applied' | 'rejected';
  code?: ErrorCode;
}

export type ApplyOutcome =
  | { status: 'applied'; released?: ReleasedEvent[] }
  | { status: 'parked' }
  | ({ status: 'rejected' } & Rejection);

export const rejected = (code: ErrorCode, message: string): ApplyOutcome => ({
  status: 'rejected',
  code,
  message,
});
