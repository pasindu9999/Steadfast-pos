import { formatAUD } from '@pos/core';

import { useRegister } from '../ui/context';
import { ApprovalBanner } from './ApprovalBanner';
import { CartActions } from './CartActions';
import { TotalRow } from './TotalRow';
import { useCartTotals } from './use-cart-totals';

export function TotalsPanel() {
  const { store } = useRegister();
  const card = useCartTotals('card');
  const cash = useCartTotals('cash');

  return (
    <section aria-label="Totals" className="space-y-1 rounded-md border-2 border-slate-300 p-4">
      <TotalRow label="Subtotal" id="subtotal" value={formatAUD(card.subtotalCents)} />
      {card.discountCents > 0 && (
        <TotalRow label="Discount" id="discount" value={formatAUD(-card.discountCents)} />
      )}
      <TotalRow
        label={store.pricesIncludeTax ? 'GST included' : 'GST'}
        id="tax"
        value={formatAUD(card.taxCents)}
      />
      <TotalRow label="Total" id="total" value={formatAUD(card.totalCents)} large />
      {cash.roundingCents !== 0 && (
        <>
          <TotalRow label="Cash rounding" id="rounding" value={formatAUD(cash.roundingCents)} />
          <TotalRow label="Cash total" id="cash-total" value={formatAUD(cash.totalCents)} />
        </>
      )}
      <ApprovalBanner />
      <CartActions />
    </section>
  );
}
