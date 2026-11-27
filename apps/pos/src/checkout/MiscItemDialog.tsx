import { useState, type FormEvent } from 'react';

import { Button } from '../ui/Button';
import { useRegisterState } from '../ui/context';
import { Dialog } from '../ui/Dialog';
import { MoneyField } from '../ui/MoneyField';
import { parseMiscPrice } from './misc-price';
import { requestMiscItem } from './register-actions';
import { useActionDeps } from './use-register-actions';

export function MiscItemDialog({ code }: { code: string }) {
  const deps = useActionDeps();
  const close = useRegisterState((register) => register.closeDialog);
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseMiscPrice(price);
    if ('error' in parsed) setError(parsed.error);
    else requestMiscItem(deps, { code, unitPriceCents: parsed.cents });
  }

  return (
    <Dialog title="Misc item" onClose={close}>
      <p>Unknown code {code}. A manager must approve the price.</p>
      <form onSubmit={submit} className="space-y-3">
        <MoneyField label="Price" value={price} onChange={setPrice} error={error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary">
            Continue
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
