import { Button } from '../ui/Button';
import { useCart } from '../ui/context';
import { unapprovedDiscountLines } from './approvals';
import { approveDiscounts } from './register-actions';
import { useActionDeps } from './use-register-actions';
import { useCartTotals } from './use-cart-totals';

/** Shown when a later change leaves a discount over the limit. Scanning carries on. */
export function ApprovalBanner() {
  const deps = useActionDeps();
  const cart = useCart((state) => state);
  const totals = useCartTotals('card');
  if (unapprovedDiscountLines(cart, totals).length === 0) return null;

  return (
    <div
      role="status"
      data-testid="approval-banner"
      className="space-y-2 rounded-md border-2 border-amber-700 bg-amber-100 p-3 text-amber-950"
    >
      <p className="font-semibold">A discount needs manager approval before payment.</p>
      <Button onClick={() => approveDiscounts(deps)}>Approve</Button>
    </div>
  );
}
