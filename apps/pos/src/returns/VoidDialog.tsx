import { formatAUD } from '@pos/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { loadReceipt } from '../print/load-receipt';
import { StaffPinForm } from '../staff/StaffPinForm';
import type { LoginStaff } from '../staff/staff-pin';
import { Button } from '../ui/Button';
import { useRegisterState, useServices } from '../ui/context';
import { Dialog } from '../ui/Dialog';
import { TextField } from '../ui/TextField';
import { REASON_MAX_LENGTH } from './build-return';
import { commitVoid } from './commit-void';
import { VoidRefusedError } from './void-error';
import { voidMessage } from './void-message';

/** Confirms a void with a manager's PIN, saves it, then shows the voided receipt. */
export function VoidDialog({ saleId }: { saleId: string }) {
  const { database, now, beep, stores } = useServices();
  const dialog = useRegisterState((register) => register.dialog);
  const close = useRegisterState((register) => register.closeDialog);
  const navigate = useNavigate();
  const receipt = useLiveQuery(() => loadReceipt(database, saleId), [database, saleId]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  async function approved(approval: LoginStaff): Promise<void> {
    // The PIN check takes a moment, and the cashier may have cancelled meanwhile.
    if (stores.register.getState().dialog !== dialog || saving.current) return;
    saving.current = true;
    try {
      await commitVoid({ saleId, reason, approval }, { database, now });
      close();
      await navigate(`/receipt/${saleId}`);
    } catch (failure) {
      saving.current = false;
      beep('error');
      setError(voidMessage(failure));
      // The error's kind only: its message could repeat what was typed.
      const kind =
        failure instanceof VoidRefusedError ? failure.code : (failure as Error | undefined)?.name;
      console.error('Sale was not voided', kind);
    }
  }

  const total = receipt && formatAUD(receipt.sale.totalCents);
  return (
    <Dialog title="Void sale" onClose={close}>
      {receipt && (
        <p className="text-xl font-bold">
          {receipt.sale.receiptNo}:{' '}
          {receipt.payment.method === 'cash'
            ? `Hand back ${total} in cash.`
            : `Reverse ${total} on the EFTPOS terminal.`}
        </p>
      )}
      <TextField
        label="Reason (optional)"
        value={reason}
        onChange={setReason}
        maxLength={REASON_MAX_LENGTH}
        error={null}
      />
      <p>A manager must approve.</p>
      <StaffPinForm
        minRole="manager"
        submitLabel="Void sale"
        onVerified={(approval) => void approved(approval)}
      />
      {error !== null && (
        <p role="alert" className="font-semibold text-red-800">
          {error}
        </p>
      )}
      <Button className="w-full" onClick={close}>
        Cancel
      </Button>
    </Dialog>
  );
}
