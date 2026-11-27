/** The cart before it is paid for. Pure functions only: nothing here is priced or stored. */
import { type Cents, type Discount, MAX_SALE_LINES } from '@pos/core';

import type { CatalogEntry } from '../catalog/catalog-index';
import type { CartLineDraft } from './sale-draft';

/** A guard against typing slips, such as a barcode typed as a quantity. */
export const MAX_LINE_QTY = 999;

const MISC_PREFIX = 'misc:';

export interface CartLine extends CartLineDraft {
  /** Identifies the line in the cart: the variant id, or `misc:<id>`. */
  key: string;
}

/** A discount a manager has seen, and the amount it applied to then. */
export interface ApprovedDiscount {
  discount: Discount;
  baseCents: Cents;
}

/** What a manager has allowed on this cart. */
export interface Approvals {
  /** The highest approved quantity of each line. */
  qty: Readonly<Record<string, number>>;
  lineDiscounts: Readonly<Record<string, ApprovedDiscount>>;
  cartDiscount: ApprovedDiscount | null;
}

export interface Cart {
  lines: readonly CartLine[];
  cartDiscount: Discount | null;
  approvals: Approvals;
  /** The line of each scan or search pick, newest last, for "undo". */
  scanHistory: readonly string[];
}

export const EMPTY_CART: Cart = {
  lines: [],
  cartDiscount: null,
  approvals: { qty: {}, lineDiscounts: {}, cartDiscount: null },
  scanHistory: [],
};

export type CartRefusal = 'TOO_MANY_LINES' | 'TOO_MANY_UNITS';

export type CartResult = { cart: Cart; key: string } | { refused: CartRefusal };

export const isMiscLine = (line: Pick<CartLine, 'key'>) => line.key.startsWith(MISC_PREFIX);

export const findLine = (cart: Pick<Cart, 'lines'>, key: string) =>
  cart.lines.find((line) => line.key === key);

function updateLine(cart: Cart, key: string, fields: Partial<CartLine>): Cart {
  const lines = cart.lines.map((line) => (line.key === key ? { ...line, ...fields } : line));
  return { ...cart, lines };
}

function appendLine(cart: Cart, line: CartLine): CartResult {
  if (cart.lines.length >= MAX_SALE_LINES) return { refused: 'TOO_MANY_LINES' };
  const scanHistory = [...cart.scanHistory, line.key];
  return { cart: { ...cart, lines: [...cart.lines, line], scanHistory }, key: line.key };
}

/** One more of a catalogue item. A new line keeps the name, SKU and price as they are now. */
export function addItem(cart: Cart, entry: CatalogEntry): CartResult {
  const key = entry.variantId;
  const existing = findLine(cart, key);
  if (!existing) {
    return appendLine(cart, {
      key,
      variantId: entry.variantId,
      sku: entry.sku,
      name: entry.displayName,
      qty: 1,
      unitPriceCents: entry.priceCents,
    });
  }
  if (existing.qty >= MAX_LINE_QTY) return { refused: 'TOO_MANY_UNITS' };
  const updated = updateLine(cart, key, { qty: existing.qty + 1 });
  return { cart: { ...updated, scanHistory: [...cart.scanHistory, key] }, key };
}

/** An item the catalogue does not know, at a price a manager typed (ARCH §13). */
export function addMiscItem(
  cart: Cart,
  {
    entry,
    unitPriceCents,
    code,
    id,
  }: {
    /** The placeholder variant that carries the sale. */
    entry: CatalogEntry;
    unitPriceCents: Cents;
    /** What was scanned or typed, kept so the catalogue can be fixed. */
    code: string;
    id: string;
  },
): CartResult {
  return appendLine(cart, {
    key: `${MISC_PREFIX}${id}`,
    variantId: entry.variantId,
    sku: entry.sku,
    name: `Misc item (${code})`,
    qty: 1,
    unitPriceCents,
  });
}

/** `qty` must be a whole number from 1. Removing a line is `removeLine`. */
export function setQty(cart: Cart, key: string, qty: number): CartResult {
  if (!Number.isSafeInteger(qty) || qty < 1) {
    throw new RangeError(`qty must be a positive integer, got ${qty}`);
  }
  if (qty > MAX_LINE_QTY) return { refused: 'TOO_MANY_UNITS' };
  if (!findLine(cart, key)) return { cart, key };
  return { cart: updateLine(cart, key, { qty }), key };
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

/** Removes a line with its history and approvals. An emptied cart starts afresh. */
export function removeLine(cart: Cart, key: string): Cart {
  const lines = cart.lines.filter((line) => line.key !== key);
  if (lines.length === 0) return EMPTY_CART;
  return {
    ...cart,
    lines,
    scanHistory: cart.scanHistory.filter((scanned) => scanned !== key),
    approvals: {
      ...cart.approvals,
      qty: without(cart.approvals.qty, key),
      lineDiscounts: without(cart.approvals.lineDiscounts, key),
    },
  };
}

/** Takes back one unit of whatever was scanned or picked last. */
export function undoLastScan(cart: Cart): Cart {
  const key = cart.scanHistory.at(-1);
  const line = key === undefined ? undefined : findLine(cart, key);
  if (!line) return cart;
  if (line.qty <= 1) return removeLine(cart, line.key);
  const updated = updateLine(cart, line.key, { qty: line.qty - 1 });
  return { ...updated, scanHistory: cart.scanHistory.slice(0, -1) };
}

export function setLineDiscount(cart: Cart, key: string, discount: Discount | null): Cart {
  return updateLine(cart, key, { discount });
}

export function setCartDiscount(cart: Cart, cartDiscount: Discount | null): Cart {
  return cart.lines.length === 0 ? cart : { ...cart, cartDiscount };
}

export function grantQuantity(cart: Cart, key: string, qty: number): Cart {
  const approved = Math.max(qty, cart.approvals.qty[key] ?? 0);
  const approvals = { ...cart.approvals, qty: { ...cart.approvals.qty, [key]: approved } };
  return { ...cart, approvals };
}
