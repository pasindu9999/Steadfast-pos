import type { TenderMethod } from '@pos/core';
import { useState, type FormEvent } from 'react';

import { Button } from '../ui/Button';
import { useRegister } from '../ui/context';
import type { ReturnableSale } from './load-returnable';
import { ReasonField } from './ReasonField';
import { RefundMethodPicker } from './RefundMethodPicker';
import { RefundSummary } from './RefundSummary';
import { quoteReturn, type ReturnSelection } from './return-quote';
import { ReturnLineItem } from './ReturnLineItem';
import { useCompleteReturn } from './use-complete-return';

const untouched = (lineNo: number): ReturnSelection => ({ lineNo, qty: 0, restock: true });

/** Chooses what comes back, why, and how it is refunded. */
export function ReturnForm({ sale }: { sale: ReturnableSale }) {
  const { store } = useRegister();
  const { complete, saving, error } = useCompleteReturn(sale);
  const [chosen, setChosen] = useState<ReadonlyMap<number, ReturnSelection>>(new Map());
  const [reason, setReason] = useState('');
  // The original tender, until the cashier chooses. A receipt code doesn't say.
  const [picked, setPicked] = useState<TenderMethod | null>(null);
  const method = picked ?? sale.tender;

  // Held to what is left, which another tab may have just changed.
  const selections = sale.lines.map((line) => {
    const selection = chosen.get(line.lineNo) ?? untouched(line.lineNo);
    return { ...selection, qty: Math.min(selection.qty, line.soldQty - line.returnedQty) };
  });
  const quote = quoteReturn(sale, selections, method, store.cashRoundingCents);
  const missing = [
    quote.lines.length === 0 && 'the items',
    method === null && 'cash or card',
    reason.trim() === '' && 'a reason',
  ].filter((step) => step !== false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (missing.length > 0 || method === null) return;
    complete({ selections, reason, method }, quote);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <ul className="divide-y divide-slate-300 border-y-2 border-slate-300">
        {sale.lines.map((line, index) => (
          <ReturnLineItem
            key={line.lineNo}
            line={line}
            selection={selections[index]}
            onChange={(selection) =>
              setChosen((current) => new Map(current).set(selection.lineNo, selection))
            }
          />
        ))}
      </ul>
      <ReasonField value={reason} onChange={setReason} />
      <RefundMethodPicker value={method} tender={sale.tender} onChange={setPicked} />
      <RefundSummary quote={quote} />
      {missing.length > 0 && <p>Still needed: {missing.join(', ')}.</p>}
      {error !== null && (
        <p role="alert" className="font-semibold text-red-800">
          {error}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        className="min-h-16 w-full text-xl"
        disabled={missing.length > 0 || saving}
      >
        Complete return
      </Button>
    </form>
  );
}
