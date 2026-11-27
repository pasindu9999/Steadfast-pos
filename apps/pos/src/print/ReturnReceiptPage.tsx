import { formatAUD } from '@pos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation, useNavigate, useParams } from 'react-router';

import { Button } from '../ui/Button';
import { useServices } from '../ui/context';
import { loadReturnReceipt } from './load-return-receipt';
import { ReturnReceipt } from './ReturnReceipt';
import { useReceiptPrinting } from './use-receipt-printing';
import { isReprint } from './use-reprint';

export function ReturnReceiptPage() {
  const { id = '' } = useParams();
  const { database } = useServices();
  const navigate = useNavigate();
  const receipt = useLiveQuery(() => loadReturnReceipt(database, id), [database, id]);
  const reprint = isReprint(useLocation().state);
  const { primary, ready, onReady, print } = useReceiptPrinting(id);

  if (receipt === undefined) return <p>Loading receipt…</p>;

  // An old return's money has already been handed back.
  const refund = reprint ? undefined : receipt?.returned.refunds[0];
  const title = reprint ? 'Return receipt' : 'Return complete';
  return (
    <div className="mx-auto max-w-md space-y-3">
      <h2 className="text-2xl font-bold">{receipt ? title : 'Return not found'}</h2>
      {refund && (
        <p className="text-4xl font-bold">
          {refund.method === 'cash' ? 'Hand back ' : 'Refunded to card '}
          <span data-testid="refund-due">{formatAUD(refund.amountCents)}</span>
        </p>
      )}
      <Button
        ref={primary}
        autoFocus
        variant="primary"
        className="min-h-16 w-full text-xl"
        onClick={() => void navigate(reprint ? '/returns' : '/')}
      >
        {reprint ? 'Back to Returns' : 'Done'}
      </Button>
      {receipt && (
        <>
          <Button className="w-full" disabled={!ready} onClick={print}>
            Print
          </Button>
          <div className="py-4">
            <ReturnReceipt receipt={receipt} onReady={onReady} />
          </div>
        </>
      )}
    </div>
  );
}
