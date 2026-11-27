/** Changing a cart that already has items. Adding is covered in `cart.test.ts`. */
import type { Discount } from '@pos/core';
import { describe, expect, it } from 'vitest';

import type { CatalogEntry } from '../catalog/catalog-index';
import {
  addItem,
  type Cart,
  type CartResult,
  EMPTY_CART,
  grantQuantity,
  MAX_LINE_QTY,
  removeLine,
  setCartDiscount,
  setLineDiscount,
  setQty,
  undoLastScan,
} from './cart';

const entry = (variantId: string): CatalogEntry => ({
  variantId,
  productId: 'p1',
  productName: 'Linen Shirt',
  brand: null,
  size: 'M',
  sizeSort: 3,
  color: 'Black',
  sku: `SKU-${variantId}`,
  barcode: null,
  priceCents: 8900,
  displayName: `Item ${variantId}`,
});

function changed(result: CartResult): Cart {
  if ('refused' in result) throw new Error(`refused: ${result.refused}`);
  return result.cart;
}

const add = (cart: Cart, variantId = 'v1') => changed(addItem(cart, entry(variantId)));
const lineOf = (cart: Cart, key: string) => cart.lines.find((line) => line.key === key);
/** v1 twice, with v2 in between. */
const stocked = () => add(add(add(EMPTY_CART), 'v1'), 'v2');
const percent = (value: number): Discount => ({ type: 'percent', value });

describe('setQty', () => {
  it.each([1, 7, MAX_LINE_QTY])('sets a quantity of %i', (qty) => {
    expect(lineOf(changed(setQty(stocked(), 'v1', qty)), 'v1')?.qty).toBe(qty);
  });

  it('refuses more than a line can hold', () => {
    expect(setQty(stocked(), 'v1', MAX_LINE_QTY + 1)).toEqual({ refused: 'TOO_MANY_UNITS' });
  });

  it.each([0, -1, 1.5, Number.NaN])('will not store a quantity of %d', (qty) => {
    expect(() => setQty(stocked(), 'v1', qty)).toThrow(RangeError);
  });

  it('leaves the cart alone for a line that is gone', () => {
    const cart = stocked();

    expect(changed(setQty(cart, 'gone', 3))).toBe(cart);
  });
});

describe('removeLine', () => {
  it('takes out the line and what belonged to it', () => {
    const cart = removeLine(grantQuantity(stocked(), 'v1', 15), 'v1');

    expect(cart.lines.map((line) => line.key)).toEqual(['v2']);
    expect(cart.scanHistory).toEqual(['v2']);
    expect(cart.approvals.qty).toEqual({});
  });

  it('forgets the line’s discount approval', () => {
    const base = stocked();
    const approved: Cart = {
      ...base,
      approvals: {
        ...base.approvals,
        lineDiscounts: { v1: { discount: percent(50), baseCents: 17_800 } },
      },
    };

    expect(removeLine(approved, 'v1').approvals.lineDiscounts).toEqual({});
  });

  it('starts afresh when the last line goes', () => {
    const cart = setCartDiscount(add(EMPTY_CART), percent(10));

    expect(removeLine(cart, 'v1')).toEqual(EMPTY_CART);
  });
});

describe('undoLastScan', () => {
  it('takes one unit back off the line scanned last', () => {
    const cart = undoLastScan(add(stocked()));

    expect(lineOf(cart, 'v1')?.qty).toBe(2);
    expect(lineOf(cart, 'v2')?.qty).toBe(1);
  });

  it('removes a line that scan created', () => {
    expect(undoLastScan(stocked()).lines.map((line) => line.key)).toEqual(['v1']);
  });

  it('steps back one scan at a time until the cart is empty', () => {
    const once = undoLastScan(add(add(EMPTY_CART)));

    expect(once.lines[0]?.qty).toBe(1);
    expect(undoLastScan(once)).toEqual(EMPTY_CART);
  });

  it('skips lines that were removed', () => {
    const cart = removeLine(add(add(EMPTY_CART), 'v2'), 'v2');

    expect(undoLastScan(cart)).toEqual(EMPTY_CART);
  });

  it('takes one unit off a quantity that was typed in', () => {
    const cart = changed(setQty(add(EMPTY_CART), 'v1', 5));

    expect(undoLastScan(cart).lines[0]?.qty).toBe(4);
  });

  it('does nothing with nothing to undo', () => {
    expect(undoLastScan(EMPTY_CART)).toBe(EMPTY_CART);
    const noHistory = { ...add(EMPTY_CART), scanHistory: [] };
    expect(undoLastScan(noHistory)).toBe(noHistory);
  });
});

describe('discounts', () => {
  it('sets and clears a line discount', () => {
    const discounted = setLineDiscount(stocked(), 'v1', percent(10));

    expect(lineOf(discounted, 'v1')?.discount).toEqual(percent(10));
    expect(lineOf(discounted, 'v2')?.discount).toBeUndefined();
    expect(lineOf(setLineDiscount(discounted, 'v1', null), 'v1')?.discount).toBeNull();
  });

  it('sets and clears the cart discount', () => {
    const discounted = setCartDiscount(stocked(), percent(10));

    expect(discounted.cartDiscount).toEqual(percent(10));
    expect(setCartDiscount(discounted, null).cartDiscount).toBeNull();
  });

  it('cannot discount an empty cart', () => {
    expect(setCartDiscount(EMPTY_CART, percent(10))).toBe(EMPTY_CART);
  });
});
