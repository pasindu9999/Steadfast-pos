import { useState, type FormEvent } from 'react';

import { Button } from '../ui/Button';
import { useCart, useRegisterState } from '../ui/context';
import { Dialog } from '../ui/Dialog';
import { findLine } from './cart';
import { parseQuantity } from './quantity-input';
import { changeQty } from './register-actions';
import { useActionDeps } from './use-register-actions';

export function QuantityDialog({ lineKey }: { lineKey: string }) {
  const deps = useActionDeps();
  const close = useRegisterState((register) => register.closeDialog);
  const line = useCart((cart) => findLine(cart, lineKey));
  const [text, setText] = useState(String(line?.qty ?? 1));
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseQuantity(text);
    if ('error' in parsed) setError(parsed.error);
    else changeQty(deps, lineKey, parsed.qty);
  }

  return (
    <Dialog title="Quantity" onClose={close}>
      <p>{line?.name}</p>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="block">Quantity</span>
          <input
            autoFocus
            // Typing replaces the current quantity.
            onFocus={(event) => event.target.select()}
            inputMode="numeric"
            autoComplete="off"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-invalid={error !== null}
            className="min-h-12 w-full rounded-md border-2 border-slate-500 px-3 text-xl"
          />
        </label>
        {error !== null && (
          <p role="alert" className="font-semibold text-red-800">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary">
            Set quantity
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
