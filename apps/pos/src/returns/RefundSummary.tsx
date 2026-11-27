import { formatAUD } from '@pos/core';

import { TotalRow } from '../checkout/TotalRow';
import type { ReturnQuote } from './return-quote';

/** What will be handed back, with any cash rounding in view. */
export function RefundSummary({ quote }: { quote: ReturnQuote }) {
  const { refundTotalCents, roundingCents, refundAmountCents } = quote;
  return (
    <div aria-live="polite">
      <TotalRow label="Refund" id="refund-total" value={formatAUD(refundTotalCents)} />
      {roundingCents !== 0 && (
        <TotalRow label="Cash rounding" id="refund-rounding" value={formatAUD(roundingCents)} />
      )}
      <TotalRow label="To hand back" id="refund-due" value={formatAUD(refundAmountCents)} large />
    </div>
  );
}
