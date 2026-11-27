import { formatAUD } from '@pos/core';

import { Button } from '../ui/Button';
import type { ReturnableLine } from './load-returnable';
import type { ReturnSelection } from './return-quote';

interface ReturnLineItemProps {
  line: ReturnableLine;
  /** Absent when the line is only shown. */
  selection?: ReturnSelection;
  onChange?: (selection: ReturnSelection) => void;
}

/** A sale line: what was sold and paid for and, while some can come back, how many are. */
export function ReturnLineItem({ line, selection, onChange }: ReturnLineItemProps) {
  const { name, soldQty, returnedQty, lineTotalCents } = line;
  const remaining = soldQty - returnedQty;

  function setQty(qty: number) {
    if (selection) onChange?.({ ...selection, qty: Math.max(0, Math.min(qty, remaining)) });
  }

  return (
    <li className="space-y-2 py-2">
      <p className="font-semibold">{name}</p>
      <p className="flex justify-between gap-4">
        <span>
          Sold {soldQty}
          {returnedQty > 0 && ` · Returned ${returnedQty}`}
        </span>
        <span className="tabular-nums">Paid {formatAUD(lineTotalCents)}</span>
      </p>
      {selection && remaining > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            aria-label={`One less of ${name}`}
            disabled={selection.qty === 0}
            onClick={() => setQty(selection.qty - 1)}
          >
            −
          </Button>
          <input
            aria-label={`Quantity to return of ${name}`}
            inputMode="numeric"
            autoComplete="off"
            value={selection.qty === 0 ? '' : String(selection.qty)}
            placeholder="0"
            onChange={(event) => {
              const digits = event.target.value.trim();
              if (/^\d*$/.test(digits)) setQty(Number(digits));
            }}
            // Enter here must not complete a refund.
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
            className="min-h-12 w-20 rounded-md border-2 border-slate-500 px-3 text-center text-xl"
          />
          <Button
            aria-label={`One more of ${name}`}
            disabled={selection.qty >= remaining}
            onClick={() => setQty(selection.qty + 1)}
          >
            +
          </Button>
          <span>of {remaining}</span>
          <label className="ml-auto flex min-h-12 items-center gap-2">
            <input
              type="checkbox"
              checked={selection.restock}
              onChange={(event) => onChange?.({ ...selection, restock: event.target.checked })}
              className="size-6"
            />
            Back into stock <span className="sr-only">for {name}</span>
            <span aria-hidden="true">(untick if damaged)</span>
          </label>
        </div>
      )}
    </li>
  );
}
