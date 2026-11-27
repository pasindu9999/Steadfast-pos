import type { CartTotals, TenderMethod } from '@pos/core';
import { useMemo } from 'react';

import { useCart, useRegister } from '../ui/context';
import { priceCart } from './price-cart';

/** The cart priced for one way of paying. Only cash is rounded. */
export function useCartTotals(tender: TenderMethod): CartTotals {
  const { store } = useRegister();
  const lines = useCart((cart) => cart.lines);
  const cartDiscount = useCart((cart) => cart.cartDiscount);
  return useMemo(
    () => priceCart({ lines, cartDiscount }, store, tender),
    [lines, cartDiscount, store, tender],
  );
}
