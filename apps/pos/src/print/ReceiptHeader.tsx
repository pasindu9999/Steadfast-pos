import type { PullStore } from '@pos/core';

import { formatStoreDateTime } from '../ui/format-time';

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
    <header className="text-center">
      <h3 className="text-xl font-bold">{store.name}</h3>
      <p>{number}</p>
      <p>{formatStoreDateTime(occurredAt, store.timezone)}</p>
      {cashierName !== null && <p>Served by {cashierName}</p>}
    </header>
  );
}
