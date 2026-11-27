/** Holds the cart. The rules live in `cart.ts`. */
import { createStore } from 'zustand/vanilla';

import { type Cart, EMPTY_CART } from './cart';

export interface CartStore extends Cart {
  replace: (cart: Cart) => void;
  clear: () => void;
}

export function createCartStore() {
  return createStore<CartStore>()((set) => ({
    ...EMPTY_CART,
    replace: (cart) => set(cart),
    clear: () => set(EMPTY_CART),
  }));
}
