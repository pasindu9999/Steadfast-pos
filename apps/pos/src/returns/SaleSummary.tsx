import { formatAUD } from '@pos/core';
import { useLiveQuery } from 'dexie-react-hooks';

import { useReprint } from '../print/use-reprint';
import { Button } from '../ui/Button';
import { useRegister, useServices } from '../ui/context';
import { formatStoreDateTime } from '../ui/format-time';
import { loadReturnable, type SaleRef } from './load-returnable';
import { ReturnForm } from './ReturnForm';
import { ReturnLineItem } from './ReturnLineItem';
import { SaleReturns } from './SaleReturns';
import { VoidSaleButton } from './VoidSaleButton';

interface SaleSummaryProps {
  saleRef: SaleRef;
  onClose: () => void;
}

/** The sale that was found, and what can still come back from it. */
export function SaleSummary({ saleRef, onClose }: SaleSummaryProps) {
  const { database } = useServices();
  const { store } = useRegister();
  const reprint = useReprint();
  const sale = useLiveQuery(() => loadReturnable(database, saleRef), [database, saleRef]);

  if (sale === undefined) return <p>Loading sale…</p>;
  if (sale === null) return <p role="alert">That sale is not on this terminal.</p>;

  const { saleId, receiptNo, occurredAt, tender, totalCents, onRecord, status, lines } = sale;
  const voided = status === 'voided';
  const allBack = lines.every((line) => line.returnedQty === line.soldQty);

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
      {voided && <p className="text-2xl font-bold text-red-800">VOIDED</p>}
      {allBack && <p className="font-semibold">Everything on this sale has been returned.</p>}
      {voided || allBack ? (
        <ul className="divide-y divide-slate-300 border-y-2 border-slate-300">
          {lines.map((line) => (
            <ReturnLineItem key={line.lineNo} line={line} />
          ))}
        </ul>
      ) : (
        // Another sale starts with a clean form.
        <ReturnForm key={saleId} sale={sale} />
      )}
      <SaleReturns saleId={saleId} />
      {/* A sale known only from its code is not stored, so there is nothing to print. */}
      {onRecord && (
        <Button className="block" onClick={() => reprint('receipt', saleId)}>
          Reprint receipt
        </Button>
      )}
      {!voided && <VoidSaleButton saleId={saleId} />}
      <Button onClick={onClose}>Close</Button>
    </section>
  );
}
