import { formatAUD } from '@pos/core';
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';

import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { MoneyField } from '../ui/MoneyField';
import { CashKeypad } from './CashKeypad';
import { QuickTender } from './QuickTender';
import { amountKeypad, checkCash, EMPTY_KEYPAD, pressKey, typeAmount } from './tender';
import { TotalRow } from './TotalRow';
import { useCartTotals } from './use-cart-totals';
import { useCompleteSale } from './use-complete-sale';
import { useShortcut } from './use-shortcut';

export function CashDialog() {
  const totals = useCartTotals('cash');
  const { complete, cancel, committing, error } = useCompleteSale();
  const [keypad, setKeypad] = useState(EMPTY_KEYPAD);
  const field = useRef<HTMLInputElement>(null);
  const cash = checkCash(keypad.text, totals.totalCents);

  // After a quick amount, go back to it: Enter then completes, and typing replaces it.
  useLayoutEffect(() => {
    if (!keypad.replace) return;
    field.current?.focus();
    field.current?.select();
  }, [keypad]);

  // F2 a second time: the customer paid the exact amount.
  useShortcut((shortcut) => {
    if (shortcut === 'exact') setKeypad(amountKeypad(totals.totalCents));
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (cash.status !== 'ready') return;
    complete({ method: 'cash', tenderedCents: cash.tenderedCents });
  }

  return (
    <Dialog title="Cash payment" onClose={cancel}>
      <TotalRow
        label="Total"
        id="pay-total"
        value={formatAUD(totals.totalCents - totals.roundingCents)}
      />
      {totals.roundingCents !== 0 && (
        <TotalRow label="Cash rounding" id="pay-rounding" value={formatAUD(totals.roundingCents)} />
      )}
      <TotalRow label="To pay" id="pay-due" value={formatAUD(totals.totalCents)} large />
      <form onSubmit={submit} className="space-y-3">
        <MoneyField
          ref={field}
          label="Cash received"
          value={keypad.text}
          onChange={(text) => setKeypad((current) => typeAmount(current, text))}
          error={cash.status === 'invalid' ? cash.message : null}
        />
        <QuickTender
          dueCents={totals.totalCents}
          onAmount={(cents) => setKeypad(amountKeypad(cents))}
        />
        <CashKeypad onKey={(key) => setKeypad((current) => pressKey(current, key))} />
        <p data-testid="change" role="status" className="text-4xl font-bold tabular-nums">
          {cash.status === 'ready' && `Change ${formatAUD(cash.changeCents)}`}
          {cash.status === 'short' && `Still to pay ${formatAUD(cash.remainingCents)}`}
        </p>
        {error !== null && (
          <p role="alert" className="font-semibold text-red-800">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="submit"
            variant="primary"
            className="min-h-16 flex-1 text-xl"
            disabled={cash.status !== 'ready' || committing}
          >
            Complete sale
          </Button>
          <Button disabled={committing} onClick={cancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
