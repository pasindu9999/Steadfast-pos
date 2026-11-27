import { formatAUD } from '@pos/core';

import { TotalRow } from '../checkout/TotalRow';
import type { PaymentRow } from '../db/types';

export function ReceiptPayment({ payment }: { payment: PaymentRow }) {
  const { method, amountCents, tenderedCents, changeCents, cardReference, cardLast4 } = payment;

  if (method === 'card') {
    return (
      <div>
        <TotalRow label="Paid by card" id="receipt-card" value={formatAUD(amountCents)} />
        {cardLast4 !== null && <p>Card ending {cardLast4}</p>}
        {cardReference !== null && <p>Reference {cardReference}</p>}
      </div>
    );
  }
  return (
    <div>
      <TotalRow
        label="Cash"
        id="receipt-tendered"
        value={formatAUD(tenderedCents ?? amountCents)}
      />
      <TotalRow label="Change" id="receipt-change" value={formatAUD(changeCents ?? 0)} />
    </div>
  );
}
