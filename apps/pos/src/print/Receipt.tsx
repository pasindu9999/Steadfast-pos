import { encodeReceiptQr, formatAUD } from '@pos/core';
import { useEffect } from 'react';

import { TotalRow } from '../checkout/TotalRow';
import type { ReceiptData } from './load-receipt';
import { ReceiptFooter } from './ReceiptFooter';
import { ReceiptHeader } from './ReceiptHeader';
import { ReceiptLines } from './ReceiptLines';
import { ReceiptPayment } from './ReceiptPayment';
import { ReceiptQr } from './ReceiptQr';

interface ReceiptProps {
  receipt: ReceiptData;
  /** Called once everything on the receipt is drawn, so it can be printed. */
  onReady?: () => void;
}

/** A sale as it was sold: every amount is the one stored, none is worked out again. */
export function Receipt({ receipt, onReady }: ReceiptProps) {
  const { sale, lines, payment, cashierName, store } = receipt;
  const { id: saleId, receiptNo } = sale;
  const voided = sale.status === 'voided';

  // Without a code there is nothing to wait for.
  useEffect(() => {
    if (voided) onReady?.();
  }, [voided, onReady]);

  return (
    <article aria-label={`Receipt ${receiptNo}`} data-print-receipt className="receipt space-y-3">
      {voided && <p className="receipt-banner">VOIDED</p>}
      <ReceiptHeader
        store={store}
        number={receiptNo}
        occurredAt={sale.occurredAt}
        cashierName={cashierName}
      />
      <ReceiptLines lines={lines} />
      <div className="receipt-keep">
        <TotalRow label="Subtotal" id="receipt-subtotal" value={formatAUD(sale.subtotalCents)} />
        {sale.discountCents > 0 && (
          <TotalRow label="Discount" id="receipt-discount" value={formatAUD(-sale.discountCents)} />
        )}
        <TotalRow
          label={store.pricesIncludeTax ? 'GST included' : 'GST'}
          id="receipt-tax"
          value={formatAUD(sale.taxCents)}
        />
        {sale.roundingCents !== 0 && (
          <TotalRow
            label="Cash rounding"
            id="receipt-rounding"
            value={formatAUD(sale.roundingCents)}
          />
        )}
        <TotalRow label="Total" id="receipt-total" value={formatAUD(sale.totalCents)} large />
      </div>
      <ReceiptPayment payment={payment} />
      {/* No code for a voided sale: nothing on it can be returned. */}
      {!voided && (
        <ReceiptQr
          payload={encodeReceiptQr({ saleId, receiptNo, lines })}
          receiptNo={receiptNo}
          onReady={onReady}
        />
      )}
      <ReceiptFooter policy />
    </article>
  );
}
