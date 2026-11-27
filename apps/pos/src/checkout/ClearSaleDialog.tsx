import { Button } from '../ui/Button';
import { useCart, useRegisterState } from '../ui/context';
import { Dialog } from '../ui/Dialog';

/** Throwing away a whole sale takes a second step. */
export function ClearSaleDialog() {
  const close = useRegisterState((register) => register.closeDialog);
  const clear = useCart((cart) => cart.clear);

  return (
    <Dialog title="Clear this sale?" onClose={close}>
      <p>All items and discounts will be removed.</p>
      <div className="flex gap-2">
        <Button autoFocus variant="primary" onClick={close}>
          Keep sale
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            clear();
            close();
          }}
        >
          Yes, clear it
        </Button>
      </div>
    </Dialog>
  );
}
