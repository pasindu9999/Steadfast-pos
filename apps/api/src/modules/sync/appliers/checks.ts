import type { ReceiptNumberParts } from '@pos/core';

import type { Prisma } from '../../../generated/prisma/client.js';
import type { AuthenticatedTerminal } from '../../terminals/device-auth.guard.js';
import { type ApplyOutcome, rejected } from './applier.js';

export function checkOrigin(
  terminal: AuthenticatedTerminal,
  storeId: string,
  number: ReceiptNumberParts | null,
): ApplyOutcome | null {
  if (storeId !== terminal.storeId) {
    return rejected('STORE_MISMATCH', 'The terminal belongs to another store');
  }
  if (number?.storeCode !== terminal.storeCode || number.terminalCode !== terminal.code) {
    return rejected('RECEIPT_MISMATCH', 'The number does not belong to this terminal');
  }
  return null;
}

export async function resolveStaff(
  tx: Prisma.TransactionClient,
  storeId: string,
  staffId: string | null,
): Promise<{ staffId: string | null; known: boolean }> {
  if (staffId === null) return { staffId, known: true };
  const found = await tx.staff.count({ where: { id: staffId, storeId } });
  return found === 1 ? { staffId, known: true } : { staffId: null, known: false };
}
