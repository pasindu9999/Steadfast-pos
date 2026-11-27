import { Button } from '../ui/Button';
import { useCart, useRegisterState } from '../ui/context';
import { KeyHint } from '../ui/KeyHint';
import { undoLastScan } from './cart';
import { discountAmount } from './describe-discount';
import { ParkButtons } from './ParkButtons';
import { PaymentButtons } from './PaymentButtons';

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
          aria-keyshortcuts="F4"
          onClick={() => openDialog({ type: 'discount', target: { type: 'cart' } })}
        >
          Cart discount <KeyHint name="F4" />
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
      <ParkButtons />
      <PaymentButtons />
    </div>
  );
}
