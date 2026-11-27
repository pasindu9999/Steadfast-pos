import { formatAUD } from '@pos/core';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { requestApproval } from '../checkout/register-actions';
import type { LoginStaff } from '../staff/staff-pin';
import { useServices, useSession } from '../ui/context';
import { commitReturn, type ReturnDraft } from './commit-return';
import type { ReturnableSale } from './load-returnable';
import { ReturnRefusedError } from './return-error';
import { returnMessage } from './return-message';
import type { ReturnQuote } from './return-quote';

/** What the form chose. The approval and card reference are collected here. */
export type ChosenReturn = Pick<ReturnDraft, 'selections' | 'reason' | 'method'>;

/** Takes the steps a refund needs, saves the return once, then shows its receipt. */
export function useCompleteReturn(sale: ReturnableSale) {
  const { database, now, beep, stores } = useServices();
  const staffId = useSession((session) => session.staff?.id ?? null);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** A ref, not state: a second Enter can arrive before the screen has updated. */
  const busy = useRef(false);

  async function save(draft: ReturnDraft): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const committed = await commitReturn(draft, { database, now });
      stores.register.getState().closeDialog();
      await navigate(`/return/${committed.return.id}`);
    } catch (failure) {
      stores.register.getState().closeDialog();
      beep('error');
      setError(returnMessage(failure));
      // The error's kind only: its message could repeat what was typed.
      const kind =
        failure instanceof ReturnRefusedError ? failure.code : (failure as Error | undefined)?.name;
      console.error('Return was not saved', kind);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function complete(chosen: ChosenReturn, quote: ReturnQuote): void {
    if (busy.current) return;
    setError(null);
    const amount = formatAUD(quote.refundAmountCents);
    const finish = (approval: LoginStaff | null, cardReference: string | null) =>
      void save({ ...chosen, ref: sale.ref, staffId, approval, cardReference });

    // A manager first, then the card machine, so no money moves on a refused return.
    const pay = (approval: LoginStaff | null) => {
      if (chosen.method !== 'card') {
        finish(approval, null);
        return;
      }
      stores.register.getState().openDialog({
        type: 'card_refund',
        amountCents: quote.refundAmountCents,
        onApproved: (reference) => finish(approval, reference),
      });
    };

    if (!quote.needsApproval) {
      pay(null);
      return;
    }
    const why = sale.onRecord
      ? `Refund of ${amount} on ${sale.receiptNo}`
      : `Refund of ${amount} on ${sale.receiptNo}, which this terminal has no record of`;
    requestApproval({ register: stores.register, beep }, why, pay);
  }

  return { complete, saving, error };
}
