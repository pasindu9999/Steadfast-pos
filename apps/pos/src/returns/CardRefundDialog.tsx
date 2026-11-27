import { formatAUD } from '@pos/core';
import { useState } from 'react';

import { checkCard } from '../checkout/tender';
import { TotalRow } from '../checkout/TotalRow';
import { Button } from '../ui/Button';
import { useRegisterState } from '../ui/context';
import { Dialog } from '../ui/Dialog';
import { TextField } from '../ui/TextField';

interface CardRefundDialogProps {
  amountCents: number;
  onApproved: (reference: string | null) => void;
}

/** Not a form: Enter in a field must never say that the refund was approved. */
export function CardRefundDialog({ amountCents, onApproved }: CardRefundDialogProps) {
  const close = useRegisterState((register) => register.closeDialog);
  const [reference, setReference] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function approved() {
    const card = checkCard(reference, '');
    if ('field' in card) {
      setProblem(card.message);
      return;
    }
    onApproved(card.cardReference);
  }

  return (
    <Dialog title="Card refund" onClose={close}>
      <TotalRow label="To refund" id="refund-card-total" value={formatAUD(amountCents)} large />
      <p>Refund the card on the EFTPOS terminal.</p>
      <TextField
        autoFocus
        label="Reference (optional)"
        value={reference}
        onChange={setReference}
        error={problem}
      />
      <p className="text-xl font-bold">Did the EFTPOS terminal approve the refund?</p>
      <div className="flex gap-2">
        <Button variant="primary" className="min-h-16 flex-1 text-xl" onClick={approved}>
          Yes, approved
        </Button>
        <Button variant="danger" onClick={close}>
          No, declined
        </Button>
      </div>
    </Dialog>
  );
}
