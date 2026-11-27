import { formatAUD } from '@pos/core';
import { useEffect } from 'react';

import { TotalRow } from '../checkout/TotalRow';
import type { ReturnReceiptData } from './load-return-receipt';
import { ReceiptFooter } from './ReceiptFooter';
import { ReceiptHeader } from './ReceiptHeader';

interface ReturnReceiptProps {
  receipt: ReturnReceiptData;
  /** Called once the receipt is on screen, so it can be printed. */
  onReady?: () => void;
}

/** A return as it was recorded: every amount is the one stored, none is worked out again. */
export function ReturnReceipt({ receipt, onReady }: ReturnReceiptProps) {
  const { returned, lines, cashierName, store } = receipt;
  const { returnNo, originalReceiptNo, refundTotalCents, roundingCents, refunds, reason } =
    returned;

  useEffect(() => onReady?.(), [onReady]);

  return (
    <article
      aria-label={`Return receipt ${returnNo}`}
      data-print-receipt
      className="receipt space-y-3"
    >
      <p className="receipt-banner">RETURN</p>
      <ReceiptHeader
        store={store}
        number={returnNo}
        occurredAt={returned.occurredAt}
        cashierName={cashierName}
      />
      <p className="text-center font-semibold">Original receipt {originalReceiptNo}</p>
      <ul className="divide-y divide-slate-300 border-y-2 border-slate-300">
        {lines.map((line) => (
          <li key={line.id} className="py-2">
            <p className="font-semibold">{line.nameSnapshot}</p>
            <p className="flex justify-between gap-4">
              <span>{line.qty} returned</span>
              <span className="tabular-nums">{formatAUD(line.refundCents)}</span>
            </p>
            {!line.restock && <p>Not returned to stock</p>}
          </li>
        ))}
      </ul>
      {reason !== null && <p>Reason: {reason}</p>}
      <div className="receipt-keep">
        <TotalRow label="Refund" id="return-total" value={formatAUD(refundTotalCents)} />
        {roundingCents !== 0 && (
          <TotalRow label="Cash rounding" id="return-rounding" value={formatAUD(roundingCents)} />
        )}
        {refunds.map((refund) => (
          <div key={refund.refundId}>
            <TotalRow
              label={`Refunded by ${refund.method}`}
              id="return-refunded"
              value={formatAUD(refund.amountCents)}
              large
            />
            {refund.cardReference !== null && <p>Reference {refund.cardReference}</p>}
          </div>
        ))}
      </div>
      <ReceiptFooter />
    </article>
  );
}
