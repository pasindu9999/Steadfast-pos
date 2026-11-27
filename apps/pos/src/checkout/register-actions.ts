/** What a scan, a search pick or a button does to the cart, and what the cashier is told. */
import type { Cents, Discount, PullStore, TenderMethod } from '@pos/core';
import { v7 as uuidv7 } from 'uuid';

import type { CatalogEntry, CatalogIndex } from '../catalog/catalog-index';
import type { Tone } from '../ui/beep';
import { grantDiscounts, needsQuantityApproval, unapprovedDiscountLines } from './approvals';
import {
  addItem,
  addMiscItem,
  type Cart,
  type CartRefusal,
  type CartResult,
  findLine,
  grantQuantity,
  MAX_LINE_QTY,
  setCartDiscount,
  setLineDiscount,
  setQty,
} from './cart';
import type { createCartStore } from './cart-store';
import { discountAmount } from './describe-discount';
import { priceCart } from './price-cart';
import type { createRegisterStore, DiscountTarget, RegisterDialog } from './register-store';

export interface ActionDeps {
  cart: ReturnType<typeof createCartStore>;
  register: ReturnType<typeof createRegisterStore>;
  catalog: CatalogIndex;
  store: PullStore;
  beep: (tone: Tone) => void;
}

const REFUSALS: Record<CartRefusal, string> = {
  TOO_MANY_LINES: 'This sale is full. Take payment, then start another.',
  TOO_MANY_UNITS: `A line can hold at most ${MAX_LINE_QTY} units.`,
};

/** Asks for a manager PIN, and runs `run` only if the same request is still open when it passes. */
export function requestApproval(
  { register, beep }: Pick<ActionDeps, 'register' | 'beep'>,
  reason: string,
  run: () => void,
): void {
  const dialog: RegisterDialog = {
    type: 'approval',
    reason,
    onApproved: () => {
      // The check takes a moment, and the cashier may have cancelled meanwhile.
      if (register.getState().dialog !== dialog) return;
      register.getState().closeDialog();
      run();
    },
  };
  beep('error');
  register.getState().openDialog(dialog);
}

function refuse({ register, beep }: ActionDeps, refusal: CartRefusal): void {
  beep('error');
  register.getState().closeDialog();
  register.getState().showNotice({ type: 'message', text: REFUSALS[refusal] });
}

/**
 * Applies a change of quantity to the current cart, after a manager PIN if it needs one.
 * `done` stores the result.
 */
function applyQuantity(
  deps: ActionDeps,
  change: (cart: Cart) => CartResult,
  done: (cart: Cart, key: string) => void,
): void {
  const before = deps.cart.getState();
  const result = change(before);
  if ('refused' in result) {
    refuse(deps, result.refused);
    return;
  }

  const line = findLine(result.cart, result.key);
  if (!line || !needsQuantityApproval(before, result.key, line.qty)) {
    done(result.cart, result.key);
    return;
  }
  requestApproval(deps, `${line.qty} units of ${line.name}`, () => {
    const approved = change(deps.cart.getState());
    if ('refused' in approved) refuse(deps, approved.refused);
    else done(grantQuantity(approved.cart, approved.key, line.qty), approved.key);
  });
}

/** Adds to the cart and tells the cashier. */
function addToCart(deps: ActionDeps, change: (cart: Cart) => CartResult): void {
  // While a sale is being saved the cart cannot change, so say that nothing was added.
  if (deps.cart.getState().committing) {
    deps.beep('error');
    return;
  }
  applyQuantity(deps, change, (cart, key) => {
    deps.cart.getState().replace(cart);
    deps.register.getState().added(key, `Added ${findLine(cart, key)?.name ?? 'item'}`);
    deps.beep('ok');
  });
}

export function addEntry(deps: ActionDeps, entry: CatalogEntry): void {
  addToCart(deps, (cart) => addItem(cart, entry));
}

export function reportNotFound({ register, beep }: ActionDeps, code: string): void {
  beep('error');
  register.getState().showNotice({ type: 'not_found', code });
}

/** An exact barcode or SKU, or nothing: a scan never picks from a search. */
export function scanCode(deps: ActionDeps, code: string): void {
  const entry = deps.catalog.lookup(code);
  if (entry) addEntry(deps, entry);
  else reportNotFound(deps, code);
}

/** A misc item always needs a manager (ARCH §13). */
export function requestMiscItem(
  deps: ActionDeps,
  { code, unitPriceCents }: { code: string; unitPriceCents: Cents },
): void {
  const entry = deps.catalog.miscItem;
  if (!entry) return;
  const item = { entry, unitPriceCents, code, id: uuidv7() };
  requestApproval(deps, `Misc item for unknown code ${code}`, () =>
    addToCart(deps, (cart) => addMiscItem(cart, item)),
  );
}

export function changeQty(deps: ActionDeps, key: string, qty: number): void {
  applyQuantity(
    deps,
    (cart) => setQty(cart, key, qty),
    (cart) => {
      deps.cart.getState().replace(cart);
      deps.register.getState().closeDialog();
    },
  );
}

/** Applies or removes a discount. One over the limit is applied only after a manager PIN. */
export function applyDiscount(
  deps: ActionDeps,
  target: DiscountTarget,
  discount: Discount | null,
): void {
  const change = (cart: Cart) =>
    target.type === 'cart'
      ? setCartDiscount(cart, discount)
      : setLineDiscount(cart, target.key, discount);
  const priced = (cart: Cart) => priceCart(cart, deps.store, 'card');
  /** The lines the manager is being asked about. */
  const affected = (cart: Cart) =>
    unapprovedDiscountLines(cart, priced(cart)).filter(
      (key) => target.type === 'cart' || key === target.key,
    );

  const next = change(deps.cart.getState());
  // Taking a discount away never needs permission.
  if (discount === null || affected(next).length === 0) {
    deps.cart.getState().replace(next);
    deps.register.getState().closeDialog();
    return;
  }
  const what = target.type === 'cart' ? 'the whole sale' : findLine(next, target.key)?.name;
  requestApproval(deps, `Discount of ${discountAmount(discount)} on ${what}`, () => {
    const latest = change(deps.cart.getState());
    deps.cart.getState().replace(grantDiscounts(latest, priced(latest), affected(latest)));
  });
}

/** Opens payment, once every discount that needs a manager has one. */
export function startPayment(deps: ActionDeps, method: TenderMethod): void {
  const { lines, committing } = deps.cart.getState();
  if (lines.length === 0 || committing) return;
  approveDiscounts(deps, () => deps.register.getState().openDialog({ type: method }));
}

/** Asks a manager to approve every discount that is waiting, then runs `then`. */
export function approveDiscounts(deps: ActionDeps, then: () => void = () => undefined): void {
  const cart = deps.cart.getState();
  const waiting = unapprovedDiscountLines(cart, priceCart(cart, deps.store, 'card'));
  if (waiting.length === 0) {
    then();
    return;
  }
  const names = waiting.map((key) => findLine(cart, key)?.name).join(', ');
  requestApproval(deps, `Discount over the limit on ${names}`, () => {
    const latest = deps.cart.getState();
    latest.replace(grantDiscounts(latest, priceCart(latest, deps.store, 'card')));
    then();
  });
}
