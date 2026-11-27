import { formatAUD } from '@pos/core';
import { useLiveQuery } from 'dexie-react-hooks';

import { Button } from '../ui/Button';
import { useRegister, useServices } from '../ui/context';
import { formatStoreDateTime } from '../ui/format-time';
import { listRecentSales, type RecentSale } from './recent-sales';

const RETURNED: Record<RecentSale['returned'], string | null> = {
  none: null,
  part: 'Part returned',
  all: 'Returned',
};

export function RecentSales({ onPick }: { onPick: (saleId: string) => void }) {
  const { database } = useServices();
  const { store } = useRegister();
  const sales = useLiveQuery(() => listRecentSales(database), [database]);

  return (
    <section aria-label="Recent sales" className="space-y-2">
      <h3 className="text-xl font-bold">Recent sales on this terminal</h3>
      {sales === undefined && <p>Loading sales…</p>}
      {sales?.length === 0 && <p>No sales on this terminal yet.</p>}
      <ul className="space-y-2">
        {sales?.map((sale) => (
          <li key={sale.saleId}>
            <Button
              className="flex w-full flex-wrap items-center gap-x-4 text-left"
              onClick={() => onPick(sale.saleId)}
            >
              <span>{sale.receiptNo}</span>
              <span className="font-normal">
                {formatStoreDateTime(sale.occurredAt, store.timezone)}
              </span>
              {sale.method !== null && <span className="font-normal">{sale.method}</span>}
              {sale.voided && <span className="text-red-800">Voided</span>}
              {RETURNED[sale.returned] !== null && (
                <span className="text-amber-900">{RETURNED[sale.returned]}</span>
              )}
              <span className="ml-auto tabular-nums">{formatAUD(sale.totalCents)}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
