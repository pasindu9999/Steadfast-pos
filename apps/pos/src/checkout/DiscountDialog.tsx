import { useState, type FormEvent } from 'react';

import { Button } from '../ui/Button';
import { useCart, useRegisterState } from '../ui/context';
import { Dialog } from '../ui/Dialog';
import { findLine } from './cart';
import { discountAmount } from './describe-discount';
import { type DiscountKind, parseDiscount } from './discount-input';
import { DiscountKindPicker } from './DiscountKindPicker';
import { applyDiscount } from './register-actions';
import type { DiscountTarget } from './register-store';
import { useActionDeps } from './use-register-actions';
import { useCartTotals } from './use-cart-totals';

export function DiscountDialog({ target }: { target: DiscountTarget }) {
  const deps = useActionDeps();
  const close = useRegisterState((register) => register.closeDialog);
  const totals = useCartTotals('card');
  const index = useCart((cart) =>
    target.type === 'line' ? cart.lines.findIndex((line) => line.key === target.key) : -1,
  );
  const line = useCart((cart) => (target.type === 'line' ? findLine(cart, target.key) : undefined));
  const cartDiscount = useCart((cart) => cart.cartDiscount);
  const onCart = target.type === 'cart';
  const current = onCart ? cartDiscount : line?.discount;
  const [kind, setKind] = useState<DiscountKind>(current?.type ?? 'percent');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const baseCents = onCart ? totals.cartBaseCents : (totals.lines[index]?.grossCents ?? 0);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseDiscount(kind, text, baseCents, onCart ? 'cart total' : 'line total');
    if ('error' in parsed) setError(parsed.error);
    else applyDiscount(deps, target, parsed.discount);
  }

  return (
    <Dialog title={onCart ? 'Cart discount' : 'Line discount'} onClose={close}>
      <p>{onCart ? 'On the whole sale' : line?.name}</p>
      {current && <p>Now: {discountAmount(current)} off</p>}
      <form onSubmit={submit} className="space-y-3">
        <DiscountKindPicker kind={kind} onChange={setKind} />
        <label className="block">
          <span className="block">{kind === 'percent' ? 'Percent off' : 'Dollars off'}</span>
          <input
            autoFocus
            inputMode="decimal"
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
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary">
            Apply
          </Button>
          {current && (
            <Button variant="danger" onClick={() => applyDiscount(deps, target, null)}>
              Remove discount
            </Button>
          )}
          <Button onClick={close}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
