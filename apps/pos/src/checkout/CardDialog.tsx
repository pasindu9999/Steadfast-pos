import { formatAUD } from '@pos/core';
import { useState } from 'react';

import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { type CardFieldError, checkCard } from './tender';
import { TextField } from '../ui/TextField';
import { TotalRow } from './TotalRow';
import { useCartTotals } from './use-cart-totals';
import { useCompleteSale } from './use-complete-sale';

/** Not a form: Enter in a field must never say that the card was approved. */
export function CardDialog() {
  const totals = useCartTotals('card');
  const { complete, cancel, committing, error } = useCompleteSale();
  const [reference, setReference] = useState('');
  const [last4, setLast4] = useState('');
  const [problem, setProblem] = useState<CardFieldError | null>(null);
  const problemFor = (name: CardFieldError['field']) =>
    problem?.field === name ? problem.message : null;

  function approved() {
    const card = checkCard(reference, last4);
    if ('field' in card) {
      setProblem(card);
      return;
    }
    setProblem(null);
    complete({ method: 'card', ...card });
  }

  return (
    <Dialog title="Card payment" onClose={cancel}>
      <TotalRow label="To pay" id="pay-total" value={formatAUD(totals.totalCents)} large />
      <p>Take the payment on the EFTPOS terminal.</p>
      <TextField
        autoFocus
        label="Reference (optional)"
        value={reference}
        onChange={setReference}
        error={problemFor('reference')}
      />
      <TextField
        label="Last 4 digits (optional)"
        inputMode="numeric"
        value={last4}
        onChange={setLast4}
        error={problemFor('last4')}
      />
      <p className="text-xl font-bold">Did the EFTPOS terminal approve?</p>
      {error !== null && (
        <p role="alert" className="font-semibold text-red-800">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="min-h-16 flex-1 text-xl"
          disabled={committing}
          onClick={approved}
        >
          Yes, approved
        </Button>
        <Button variant="danger" disabled={committing} onClick={cancel}>
          No, declined
        </Button>
      </div>
    </Dialog>
  );
}
