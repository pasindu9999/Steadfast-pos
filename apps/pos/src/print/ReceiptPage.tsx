import { formatAUD } from '@pos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router';

import { Button } from '../ui/Button';
import { useServices } from '../ui/context';
import { loadReceipt } from './load-receipt';
import { Receipt } from './Receipt';

export function ReceiptPage() {
  const { id = '' } = useParams();
  const { database } = useServices();
  const navigate = useNavigate();
  const receipt = useLiveQuery(() => loadReceipt(database, id), [database, id]);

  if (receipt === undefined) return <p>Loading receipt…</p>;

  const voided = receipt?.sale.status === 'voided';
  // Nothing was bought, so there is no change to give.
  const change = voided ? null : receipt?.payment.changeCents;
  const title = voided ? 'Sale voided' : 'Sale complete';
  return (
    <div className="mx-auto max-w-md space-y-3">
      <h2 className="text-2xl font-bold">{receipt ? title : 'Receipt not found'}</h2>
      {change != null && (
        <p className="text-4xl font-bold">
          Change <span data-testid="change-due">{formatAUD(change)}</span>
        </p>
      )}
      <Button
        autoFocus
        variant="primary"
        className="min-h-16 w-full text-xl"
        onClick={() => void navigate('/')}
      >
        New sale
      </Button>
      {receipt && <Receipt receipt={receipt} />}
    </div>
  );
}
