/** How the till prices a cart: always `calculateCart` from `@pos/core` (ARCH §6.4). */
import {
  calculateCart,
  type CartTotals,
  type PullStore,
  type StoreConfig,
  type TenderMethod,
} from '@pos/core';

import type { Cart } from './cart';

export function toStoreConfig(store: PullStore): StoreConfig {
  return { ...store, storeId: store.id };
}

export function priceCart(
  { lines, cartDiscount }: Pick<Cart, 'lines' | 'cartDiscount'>,
  store: PullStore,
  tender: TenderMethod,
): CartTotals {
  return calculateCart(lines, cartDiscount, toStoreConfig(store), tender);
}
