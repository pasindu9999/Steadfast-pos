import { useCart } from '../ui/context';
import { CartLineItem } from './CartLineItem';
import { useCartTotals } from './use-cart-totals';

export function CartPanel() {
  const lines = useCart((cart) => cart.lines);
  // Line amounts are the same for cash and card: only the cart total is rounded.
  const totals = useCartTotals('card');

  return (
    <section aria-label="Cart" className="rounded-md border-2 border-slate-300">
      {lines.length === 0 ? (
        <p className="p-4">No items yet. Scan or search to start a sale.</p>
      ) : (
        <ul className="divide-y divide-slate-300">
          {lines.map((line, index) => (
            <CartLineItem key={line.key} line={line} priced={totals.lines[index]!} />
          ))}
        </ul>
      )}
    </section>
  );
}
