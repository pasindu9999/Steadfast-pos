/** Holds the cart. The rules live in `cart.ts`. */
import { createStore } from 'zustand/vanilla';

import { type Cart, EMPTY_CART } from './cart';

export interface CartStore extends Cart {
  /** A sale of this cart is being saved. Until it is, the cart cannot change. */
  committing: boolean;
  replace: (cart: Cart) => void;
  clear: () => void;
  /** Takes the cart for saving. `false` if it is already being saved. */
  beginCommit: () => boolean;
  /** A paid cart is emptied; otherwise it is kept for another try. */
  endCommit: (paid: boolean) => void;
}

export function createCartStore() {
  return createStore<CartStore>()((set, get) => ({
    ...EMPTY_CART,
    committing: false,
    replace: ({ lines, cartDiscount, approvals, scanHistory }) => {
      if (!get().committing) set({ lines, cartDiscount, approvals, scanHistory });
    },
    clear: () => {
      if (!get().committing) set(EMPTY_CART);
    },
    // Set at once, so a second click or Enter sees it before any waiting starts.
    beginCommit: () => {
      if (get().committing) return false;
      set({ committing: true });
      return true;
    },
    endCommit: (paid) => set(paid ? { ...EMPTY_CART, committing: false } : { committing: false }),
  }));
}
