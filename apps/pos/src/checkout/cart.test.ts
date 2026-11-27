import { MAX_SALE_LINES, MISC_SKU } from '@pos/core';
import { describe, expect, it } from 'vitest';

import type { CatalogEntry } from '../catalog/catalog-index';
import { needsQuantityApproval } from './approvals';
import {
  addItem,
  addMiscItem,
  type Cart,
  type CartResult,
  EMPTY_CART,
  grantQuantity,
  isMiscLine,
  MAX_LINE_QTY,
} from './cart';

export function entry(fields: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    variantId: 'v1',
    productId: 'p1',
    productName: 'Linen Shirt',
    brand: null,
    size: 'M',
    sizeSort: 3,
    color: 'Black',
    sku: 'LIN-BLK-M',
    barcode: '2000000000077',
    priceCents: 8900,
    displayName: 'Linen Shirt — Black / M',
    ...fields,
  };
}

function changed(result: CartResult): Cart {
  if ('refused' in result) throw new Error(`refused: ${result.refused}`);
  return result.cart;
}

const add = (cart: Cart, fields?: Partial<CatalogEntry>) => changed(addItem(cart, entry(fields)));

describe('addItem', () => {
  it('adds a line with the name, SKU and price as they are now', () => {
    const result = addItem(EMPTY_CART, entry());

    expect(result).toMatchObject({ key: 'v1' });
    expect(changed(result).lines).toEqual([
      {
        key: 'v1',
        variantId: 'v1',
        sku: 'LIN-BLK-M',
        name: 'Linen Shirt — Black / M',
        qty: 1,
        unitPriceCents: 8900,
      },
    ]);
  });

  it('counts a second scan on the same line', () => {
    const cart = add(add(EMPTY_CART));

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.qty).toBe(2);
  });

  it('keeps the price the customer saw when the catalogue changes', () => {
    const cart = add(add(EMPTY_CART), { priceCents: 9900, displayName: 'Renamed' });

    expect(cart.lines[0]).toMatchObject({
      qty: 2,
      unitPriceCents: 8900,
      name: 'Linen Shirt — Black / M',
    });
  });

  it('puts another item on its own line', () => {
    const cart = add(add(EMPTY_CART), { variantId: 'v2' });

    expect(cart.lines.map((line) => line.key)).toEqual(['v1', 'v2']);
  });

  it('remembers each scan, newest last', () => {
    const cart = add(add(add(EMPTY_CART), { variantId: 'v2' }));

    expect(cart.scanHistory).toEqual(['v1', 'v2', 'v1']);
  });

  it('does not change the cart it was given', () => {
    const first = add(EMPTY_CART);
    add(first);

    expect(first.lines[0]?.qty).toBe(1);
    expect(EMPTY_CART.lines).toEqual([]);
  });

  it(`stops at ${MAX_LINE_QTY} units on a line`, () => {
    const one = add(EMPTY_CART);
    const full: Cart = { ...one, lines: [{ ...one.lines[0]!, qty: MAX_LINE_QTY }] };

    expect(addItem(full, entry())).toEqual({ refused: 'TOO_MANY_UNITS' });
  });

  it('stops at the number of lines a sale can carry', () => {
    let cart = EMPTY_CART;
    for (let index = 0; index < MAX_SALE_LINES; index += 1) {
      cart = add(cart, { variantId: `v${index}` });
    }

    expect(addItem(cart, entry({ variantId: 'one-more' }))).toEqual({ refused: 'TOO_MANY_LINES' });
    expect(changed(addItem(cart, entry({ variantId: 'v0' }))).lines[0]?.qty).toBe(2);
  });
});

describe('addMiscItem', () => {
  const misc = entry({ variantId: 'vm', sku: MISC_SKU, priceCents: 0 });
  const item = { entry: misc, unitPriceCents: 1250, code: '9300000000001', id: 'a' };

  it('adds a line at the typed price, named after the unknown code', () => {
    const cart = changed(addMiscItem(EMPTY_CART, item));

    expect(cart.lines[0]).toEqual({
      key: 'misc:a',
      variantId: 'vm',
      sku: MISC_SKU,
      name: 'Misc item (9300000000001)',
      qty: 1,
      unitPriceCents: 1250,
    });
    expect(isMiscLine(cart.lines[0]!)).toBe(true);
  });

  it('keeps misc items apart, even for the same code', () => {
    const first = changed(addMiscItem(EMPTY_CART, item));
    const second = changed(addMiscItem(first, { ...item, id: 'b', unitPriceCents: 500 }));

    expect(second.lines.map((line) => line.key)).toEqual(['misc:a', 'misc:b']);
  });

  it('is not mistaken for a catalogue item', () => {
    expect(isMiscLine(add(EMPTY_CART).lines[0]!)).toBe(false);
  });
});

describe('quantity approval', () => {
  const withQty = (qty: number): Cart => {
    const one = add(EMPTY_CART);
    return { ...one, lines: [{ ...one.lines[0]!, qty }] };
  };

  it('is not needed up to ten', () => {
    expect(needsQuantityApproval(withQty(9), 'v1', 10)).toBe(false);
  });

  it('is needed for the eleventh', () => {
    expect(needsQuantityApproval(withQty(10), 'v1', 11)).toBe(true);
  });

  it('is needed to start a line above ten', () => {
    expect(needsQuantityApproval(EMPTY_CART, 'v1', 12)).toBe(true);
  });

  it('covers the line up to the approved quantity', () => {
    const approved = grantQuantity(withQty(10), 'v1', 15);

    expect(needsQuantityApproval(approved, 'v1', 15)).toBe(false);
    expect(needsQuantityApproval(approved, 'v1', 16)).toBe(true);
    expect(needsQuantityApproval(approved, 'v2', 11)).toBe(true);
  });

  it('is not needed to reduce a quantity', () => {
    expect(needsQuantityApproval(withQty(20), 'v1', 15)).toBe(false);
  });

  it('keeps the higher approval', () => {
    const cart = grantQuantity(grantQuantity(withQty(10), 'v1', 20), 'v1', 12);

    expect(cart.approvals.qty.v1).toBe(20);
  });
});
