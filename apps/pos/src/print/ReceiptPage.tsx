import { formatAUD } from '@pos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation, useNavigate, useParams } from 'react-router';

import { Button } from '../ui/Button';
import { useServices } from '../ui/context';
import { AutoPrintToggle } from './AutoPrintToggle';
import { loadReceipt } from './load-receipt';
import { Receipt } from './Receipt';
import { useReceiptPrinting } from './use-receipt-printing';
import { isReprint } from './use-reprint';

export function ReceiptPage() {
  const { id = '' } = useParams();
  const { database } = useServices();
  const navigate = useNavigate();
  const receipt = useLiveQuery(() => loadReceipt(database, id), [database, id]);
  const reprint = isReprint(useLocation().state);
  const { primary, ready, onReady, print } = useReceiptPrinting(id);

  if (receipt === undefined) return <p>Loading receipt…</p>;

  const voided = receipt?.sale.status === 'voided';
  // No change to give for a void, nor a second time for an old receipt.
  const change = voided || reprint ? null : receipt?.payment.changeCents;
  const title = reprint ? 'Receipt' : voided ? 'Sale voided' : 'Sale complete';
  return (
    <div className="mx-auto max-w-md space-y-3">
      <h2 className="text-2xl font-bold">{receipt ? title : 'Receipt not found'}</h2>
      {change != null && (
        <p className="text-4xl font-bold">
          Change <span data-testid="change-due">{formatAUD(change)}</span>
        </p>
      )}
      <Button
        ref={primary}
        autoFocus
        variant="primary"
        className="min-h-16 w-full text-xl"
        onClick={() => void navigate(reprint ? '/returns' : '/')}
      >
        {reprint ? 'Back to Returns' : 'New sale'}
      </Button>
      {receipt && (
        <>
          <Button className="w-full" disabled={!ready} onClick={print}>
            Print
          </Button>
          <AutoPrintToggle />
          <div className="py-4">
            <Receipt receipt={receipt} onReady={onReady} />
          </div>
        </>
      )}
    </div>
  );
}
