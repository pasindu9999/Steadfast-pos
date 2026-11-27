/** When a sale may still be voided rather than returned (ARCH §7.4). Pure. */
import type { SaleRow } from '../db/types';
import { isSameStoreDay } from './store-day';

export type VoidRefusal = 'OTHER_TERMINAL' | 'ALREADY_VOIDED' | 'HAS_RETURNS' | 'NOT_TODAY';

export interface VoidCheck {
  /** `undefined` if this terminal has not stored the sale. */
  sale: Pick<SaleRow, 'terminalId' | 'status' | 'occurredAt'> | undefined;
  /** This terminal. */
  terminalId: string;
  /** Whether anything on the sale has been returned here. */
  hasReturns: boolean;
  now: Date;
  timeZone: string;
}

/** Why the sale can't be voided, or `null` if it can. A manager still has to approve. */
export function voidRefusal({
  sale,
  terminalId,
  hasReturns,
  now,
  timeZone,
}: VoidCheck): VoidRefusal | null {
  if (!sale || sale.terminalId !== terminalId) return 'OTHER_TERMINAL';
  if (sale.status === 'voided') return 'ALREADY_VOIDED';
  if (hasReturns) return 'HAS_RETURNS';
  return isSameStoreDay(new Date(sale.occurredAt), now, timeZone) ? null : 'NOT_TODAY';
}
