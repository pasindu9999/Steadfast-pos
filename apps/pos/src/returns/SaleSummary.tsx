import { formatAUD } from '@pos/core';
import { useLiveQuery } from 'dexie-react-hooks';

import { Button } from '../ui/Button';
import { useRegister, useServices } from '../ui/context';
import { formatStoreDateTime } from '../ui/format-time';
import { loadReturnable, type SaleRef } from './load-returnable';

interface SaleSummaryProps {
  saleRef: SaleRef;
  onClose: () => void;
}

/** The sale that was found, and what can still come back from it. */
export function SaleSummary({ saleRef, onClose }: SaleSummaryProps) {
  const { database } = useServices();
  const { store } = useRegister();
  const sale = useLiveQuery(() => loadReturnable(database, saleRef), [database, saleRef]);

  if (sale === undefined) return <p>Loading sale…</p>;
  if (sale === null) return <p role="alert">That sale is not on this terminal.</p>;

  const { receiptNo, occurredAt, tender, totalCents, onRecord, status, lines } = sale;
  return (
    <section
      aria-label={`Sale ${receiptNo}`}
      className="space-y-3 rounded-md border-2 border-slate-300 p-4"
    >
      <h3 className="text-xl font-bold">{receiptNo}</h3>
      {occurredAt !== null && <p>{formatStoreDateTime(occurredAt, store.timezone)}</p>}
      {tender !== null && totalCents !== null && (
        <p>
          Paid by {tender}: {formatAUD(totalCents)}
        </p>
      )}
      {!onRecord && (
        <p className="font-semibold">
          Sold on another terminal. These details come from the receipt code.
        </p>
      )}
      {status === 'voided' && <p className="text-2xl font-bold text-red-800">VOIDED</p>}
      <ul className="divide-y divide-slate-300 border-y-2 border-slate-300">
        {lines.map((line) => (
          <li key={line.lineNo} className="py-2">
            <p className="font-semibold">{line.name}</p>
            <p className="flex justify-between gap-4">
              <span>
                Sold {line.soldQty}
                {line.returnedQty > 0 && ` · Returned ${line.returnedQty}`}
              </span>
              <span className="tabular-nums">Paid {formatAUD(line.lineTotalCents)}</span>
            </p>
          </li>
        ))}
      </ul>
      <Button onClick={onClose}>Close</Button>
    </section>
  );
}
