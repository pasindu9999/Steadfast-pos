import { encodeReceiptQr, formatAUD } from '@pos/core';

import { TotalRow } from '../checkout/TotalRow';
import { formatStoreDateTime } from '../ui/format-time';
import type { ReceiptData } from './load-receipt';
import { ReceiptLines } from './ReceiptLines';
import { ReceiptPayment } from './ReceiptPayment';
import { ReceiptQr } from './ReceiptQr';

/** A sale as it was sold: every amount is the one stored, none is worked out again. */
export function Receipt({ receipt }: { receipt: ReceiptData }) {
  const { sale, lines, payment, cashierName, store } = receipt;
  const { id: saleId, receiptNo } = sale;

  return (
    <article
      aria-label={`Receipt ${receiptNo}`}
      className="space-y-3 rounded-md border-2 border-slate-300 bg-white p-4"
    >
      <header className="text-center">
        <h3 className="text-xl font-bold">{store.name}</h3>
        <p>{receiptNo}</p>
        <p>{formatStoreDateTime(sale.occurredAt, store.timezone)}</p>
        {cashierName !== null && <p>Served by {cashierName}</p>}
      </header>
      <ReceiptLines lines={lines} />
      <div>
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
      <ReceiptQr payload={encodeReceiptQr({ saleId, receiptNo, lines })} receiptNo={receiptNo} />
    </article>
  );
}
