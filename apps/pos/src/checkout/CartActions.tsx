import { Button } from '../ui/Button';
import { useCart, useRegisterState } from '../ui/context';
import { undoLastScan } from './cart';
import { discountAmount } from './describe-discount';

export function CartActions() {
  const empty = useCart((cart) => cart.lines.length === 0);
  const undoable = useCart((cart) => cart.scanHistory.length > 0);
  const cartDiscount = useCart((cart) => cart.cartDiscount);
  const replace = useCart((cart) => cart.replace);
  const cart = useCart((state) => state);
  const openDialog = useRegisterState((register) => register.openDialog);

  return (
    <div className="space-y-2 pt-3">
      <Button className="w-full" disabled={!undoable} onClick={() => replace(undoLastScan(cart))}>
        Undo last scan
      </Button>
      <div>
        <Button
          className="w-full"
          disabled={empty}
          onClick={() => openDialog({ type: 'discount', target: { type: 'cart' } })}
        >
          Cart discount
        </Button>
        {cartDiscount && (
          <p className="text-sm">{discountAmount(cartDiscount)} off the whole sale</p>
        )}
      </div>
      <Button
        variant="danger"
        className="w-full"
        disabled={empty}
        onClick={() => openDialog({ type: 'clear_sale' })}
      >
        Clear sale
      </Button>
      <div className="grid grid-cols-2 gap-2">
        {/* Payment arrives with task P4-4. */}
        <Button variant="primary" className="min-h-16 text-xl" disabled>
          Cash
        </Button>
        <Button variant="primary" className="min-h-16 text-xl" disabled>
          Card
        </Button>
      </div>
    </div>
  );
}
