import { formatAUD } from '@pos/core';

import { TotalRow } from '../checkout/TotalRow';
import type { ReturnReceiptData } from './load-return-receipt';
import { ReceiptHeader } from './ReceiptHeader';

/** A return as it was recorded: every amount is the one stored, none is worked out again. */
export function ReturnReceipt({ receipt }: { receipt: ReturnReceiptData }) {
  const { returned, lines, cashierName, store } = receipt;
  const { returnNo, originalReceiptNo, refundTotalCents, roundingCents, refunds, reason } =
    returned;

  return (
    <article
      aria-label={`Return receipt ${returnNo}`}
      className="space-y-3 rounded-md border-2 border-slate-300 bg-white p-4"
    >
      <p className="text-center text-4xl font-bold tracking-widest">RETURN</p>
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
      <div>
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
    </article>
  );
}
