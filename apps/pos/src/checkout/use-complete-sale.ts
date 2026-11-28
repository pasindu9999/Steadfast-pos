import { useState } from 'react';
import { useNavigate } from 'react-router';

import { requestAutoPrint } from '../print/auto-print';
import { useCart, useServices, useSession } from '../ui/context';
import { completeSale } from './complete-sale';
import type { TenderInput } from './sale-draft';
import { useActionDeps } from './use-register-actions';

/** For the payment dialogs: saves the sale, then shows its receipt. */
export function useCompleteSale() {
  const { database, now, printer } = useServices();
  const { cart, register, store, beep } = useActionDeps();
  const staffId = useSession((session) => session.staff?.id ?? null);
  const committing = useCart((state) => state.committing);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function complete(tender: TenderInput): Promise<void> {
    const result = await completeSale({ cart, database, store, staffId, now }, tender);
    if (result.status === 'saved') {
      // Before the dialog closes, so no scan can slip in ahead of the receipt.
      await requestAutoPrint(database, printer, result.saleId);
      register.getState().closeDialog();
      await navigate(`/receipt/${result.saleId}`);
    } else if (result.status === 'failed') {
      beep('error');
      setError(result.message);
    }
  }

  /** The dialog stays open while the sale is being saved. */
  function cancel(): void {
    if (!cart.getState().committing) register.getState().closeDialog();
  }

  return {
    complete: (tender: TenderInput) => {
      setError(null);
      void complete(tender);
    },
    cancel,
    committing,
    error,
  };
}
