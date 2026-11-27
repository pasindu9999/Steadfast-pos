import { formatAUD } from '@pos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router';

import { Button } from '../ui/Button';
import { useServices } from '../ui/context';
import { loadReturnReceipt } from './load-return-receipt';
import { ReturnReceipt } from './ReturnReceipt';

export function ReturnReceiptPage() {
  const { id = '' } = useParams();
  const { database } = useServices();
  const navigate = useNavigate();
  const receipt = useLiveQuery(() => loadReturnReceipt(database, id), [database, id]);

  if (receipt === undefined) return <p>Loading receipt…</p>;

  const refund = receipt?.returned.refunds[0];
  return (
    <div className="mx-auto max-w-md space-y-3">
      <h2 className="text-2xl font-bold">{receipt ? 'Return complete' : 'Return not found'}</h2>
      {refund && (
        <p className="text-4xl font-bold">
          {refund.method === 'cash' ? 'Hand back ' : 'Refunded to card '}
          <span data-testid="refund-due">{formatAUD(refund.amountCents)}</span>
        </p>
      )}
      <Button
        autoFocus
        variant="primary"
        className="min-h-16 w-full text-xl"
        onClick={() => void navigate('/')}
      >
        Done
      </Button>
      {receipt && <ReturnReceipt receipt={receipt} />}
    </div>
  );
}
