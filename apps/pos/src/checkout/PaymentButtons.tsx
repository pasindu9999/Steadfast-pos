import { Button } from '../ui/Button';
import { useCart } from '../ui/context';
import { KeyHint } from '../ui/KeyHint';
import { startPayment } from './register-actions';
import { useActionDeps } from './use-register-actions';

export function PaymentButtons() {
  const deps = useActionDeps();
  const empty = useCart((cart) => cart.lines.length === 0);

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        variant="primary"
        className="min-h-16 text-xl"
        disabled={empty}
        aria-keyshortcuts="F2"
        onClick={() => startPayment(deps, 'cash')}
      >
        Cash <KeyHint name="F2" />
      </Button>
      <Button
        variant="primary"
        className="min-h-16 text-xl"
        disabled={empty}
        aria-keyshortcuts="F3"
        onClick={() => startPayment(deps, 'card')}
      >
        Card <KeyHint name="F3" />
      </Button>
    </div>
  );
}
