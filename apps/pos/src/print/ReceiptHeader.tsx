import type { PullStore } from '@pos/core';

import { formatStoreDateTime } from '../ui/format-time';
import { STORE_ABN } from './receipt-text';

interface ReceiptHeaderProps {
  store: PullStore;
  /** The receipt or return number. */
  number: string;
  occurredAt: string;
  cashierName: string | null;
}

/** The top of every receipt. */
export function ReceiptHeader({ store, number, occurredAt, cashierName }: ReceiptHeaderProps) {
  return (
    <header className="receipt-keep text-center">
      <h3>{store.name}</h3>
      <p>{STORE_ABN}</p>
      <p>{number}</p>
      <p>{formatStoreDateTime(occurredAt, store.timezone)}</p>
      {cashierName !== null && <p>Served by {cashierName}</p>}
    </header>
  );
}
