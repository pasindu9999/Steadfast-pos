import { type CalculatedLine, formatAUD } from '@pos/core';

import { Button } from '../ui/Button';
import { useCart, useRegisterState } from '../ui/context';
import { type CartLine, isMiscLine, removeLine } from './cart';
import { discountSources } from './describe-discount';
import { changeQty } from './register-actions';
import { StockChip } from './StockChip';
import { useActionDeps } from './use-register-actions';

interface CartLineItemProps {
  line: CartLine;
  priced: CalculatedLine;
}

export function CartLineItem({ line, priced }: CartLineItemProps) {
  const deps = useActionDeps();
  const flash = useRegisterState((register) => register.flashKey === line.key);
  const openDialog = useRegisterState((register) => register.openDialog);
  const replace = useCart((cart) => cart.replace);
  const { key, name, qty, discount } = line;

  return (
    <li data-flash={flash} className="space-y-2 p-3 data-[flash=true]:bg-yellow-200">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <span className="mr-auto text-lg font-semibold">{name}</span>
        <span>{formatAUD(line.unitPriceCents)} each</span>
        <span data-testid="line-total" className="text-lg font-bold tabular-nums">
          {formatAUD(priced.lineTotalCents)}
        </span>
      </div>
      {priced.discountCents > 0 && (
        <p className="text-sm">
          Discount {formatAUD(-priced.discountCents)} ({discountSources(discount, priced)})
        </p>
      )}
      {!isMiscLine(line) && <StockChip variantId={line.variantId} />}
      <div className="flex flex-wrap gap-2">
        <Button
          aria-label={`Decrease quantity of ${name}`}
          disabled={qty <= 1}
          onClick={() => changeQty(deps, key, qty - 1)}
        >
          −
        </Button>
        <Button
          aria-label={`Edit quantity of ${name}`}
          onClick={() => openDialog({ type: 'quantity', key })}
        >
          <span data-testid="qty">{qty}</span>
        </Button>
        <Button
          aria-label={`Increase quantity of ${name}`}
          onClick={() => changeQty(deps, key, qty + 1)}
        >
          +
        </Button>
        <Button
          className="ml-auto"
          aria-label={`Discount on ${name}`}
          onClick={() => openDialog({ type: 'discount', target: { type: 'line', key } })}
        >
          Discount
        </Button>
        <Button
          variant="danger"
          aria-label={`Remove ${name}`}
          onClick={() => replace(removeLine(deps.cart.getState(), key))}
        >
          Remove
        </Button>
      </div>
    </li>
  );
}
