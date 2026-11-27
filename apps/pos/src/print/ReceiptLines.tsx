import { formatAUD } from '@pos/core';

import type { SaleLineRow } from '../db/types';

export function ReceiptLines({ lines }: { lines: readonly SaleLineRow[] }) {
  return (
    <ul className="divide-y divide-slate-300 border-y-2 border-slate-300">
      {lines.map((line) => (
        <li key={line.id} className="py-2">
          <p className="font-semibold">{line.nameSnapshot}</p>
          <p className="flex justify-between gap-4">
            <span>
              {line.qty} × {formatAUD(line.unitPriceCents)}
            </span>
            <span className="tabular-nums">{formatAUD(line.lineTotalCents)}</span>
          </p>
          {line.lineDiscountCents > 0 && <p>Discount {formatAUD(-line.lineDiscountCents)}</p>}
        </li>
      ))}
    </ul>
  );
}
