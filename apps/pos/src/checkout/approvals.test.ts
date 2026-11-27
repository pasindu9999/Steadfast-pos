import type { Discount } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { storeFixture } from '../test/fixtures';
import { grantDiscounts, unapprovedDiscountLines } from './approvals';
import {
  type Cart,
  type CartLine,
  EMPTY_CART,
  removeLine,
  setCartDiscount,
  setLineDiscount,
  setQty,
} from './cart';
import { priceCart } from './price-cart';

const percent = (value: number): Discount => ({ type: 'percent', value });
const fixed = (value: number): Discount => ({ type: 'fixed', value });

const line = (key: string, unitPriceCents = 10_000, qty = 1): CartLine => ({
  key,
  variantId: key,
  sku: key,
  name: key,
  qty,
  unitPriceCents,
});
const cartOf = (...lines: CartLine[]): Cart => ({ ...EMPTY_CART, lines });

const totalsOf = (cart: Cart) => priceCart(cart, storeFixture, 'card');
const unapproved = (cart: Cart) => unapprovedDiscountLines(cart, totalsOf(cart));
const approve = (cart: Cart) => grantDiscounts(cart, totalsOf(cart));
const withQty = (cart: Cart, key: string, qty: number) => {
  const result = setQty(cart, key, qty);
  if ('refused' in result) throw new Error(result.refused);
  return result.cart;
};

describe('unapprovedDiscountLines', () => {
  const a = cartOf(line('a'));

  it('allows 20 % and asks above it', () => {
    expect(unapproved(setLineDiscount(a, 'a', percent(20)))).toEqual([]);
    expect(unapproved(setLineDiscount(a, 'a', percent(21)))).toEqual(['a']);
  });

  it('judges a dollar discount against the line', () => {
    expect(unapproved(setLineDiscount(a, 'a', fixed(2000)))).toEqual([]);
    expect(unapproved(setLineDiscount(a, 'a', fixed(2001)))).toEqual(['a']);
  });

  it('adds up the line and cart discounts', () => {
    const cart = setCartDiscount(setLineDiscount(a, 'a', percent(15)), percent(10));

    expect(unapproved(cart)).toEqual(['a']);
  });

  it('names only the lines over the limit', () => {
    const cart = setLineDiscount(cartOf(line('a'), line('b')), 'b', percent(50));

    expect(unapproved(cart)).toEqual(['b']);
  });

  it('is satisfied by an approval of the same discount', () => {
    expect(unapproved(approve(setLineDiscount(a, 'a', percent(30))))).toEqual([]);
    expect(unapproved(approve(setCartDiscount(a, percent(30))))).toEqual([]);
  });

  it('covers a lower discount of the same kind', () => {
    const approved = approve(setLineDiscount(a, 'a', percent(40)));

    expect(unapproved(setLineDiscount(approved, 'a', percent(30)))).toEqual([]);
  });

  it('asks again for a higher one', () => {
    const approved = approve(setLineDiscount(a, 'a', percent(30)));

    expect(unapproved(setLineDiscount(approved, 'a', percent(31)))).toEqual(['a']);
  });

  it('asks again when the kind changes', () => {
    const approved = approve(setLineDiscount(a, 'a', percent(30)));

    expect(unapproved(setLineDiscount(approved, 'a', fixed(2500)))).toEqual(['a']);
  });

  it('does not let an approved line discount cover a new cart discount', () => {
    const approved = approve(setLineDiscount(a, 'a', percent(30)));

    expect(unapproved(setCartDiscount(approved, percent(5)))).toEqual(['a']);
  });

  it('keeps a percentage approval when the quantity changes', () => {
    const approved = approve(setLineDiscount(cartOf(line('a', 999, 2)), 'a', percent(25)));

    expect(unapproved(withQty(approved, 'a', 1))).toEqual([]);
    expect(unapproved(withQty(approved, 'a', 3))).toEqual([]);
  });

  it('asks again when an approved dollar discount covers fewer units', () => {
    const approved = approve(setLineDiscount(cartOf(line('a', 10_000, 2)), 'a', fixed(5000)));

    expect(unapproved(withQty(approved, 'a', 1))).toEqual(['a']);
    expect(unapproved(withQty(approved, 'a', 3))).toEqual([]);
  });

  it('flags a dollar discount that was small until the quantity fell', () => {
    const cart = setLineDiscount(cartOf(line('a', 10_000, 2)), 'a', fixed(3000));

    expect(unapproved(cart)).toEqual([]);
    expect(unapproved(withQty(cart, 'a', 1))).toEqual(['a']);
  });

  it('asks again when an approved dollar cart discount is spread over less', () => {
    const approved = approve(setCartDiscount(cartOf(line('a'), line('b')), fixed(6000)));

    expect(unapproved(approved)).toEqual([]);
    expect(unapproved(removeLine(approved, 'b'))).toEqual(['a']);
  });

  it('covers a line added under an approved cart percentage', () => {
    const approved = approve(setCartDiscount(a, percent(30)));
    const cart = { ...approved, lines: [...approved.lines, line('b')] };

    expect(unapproved(cart)).toEqual([]);
  });

  it('forgets the approval of a removed line', () => {
    const approved = approve(setLineDiscount(cartOf(line('a'), line('b')), 'a', percent(30)));
    const without = removeLine(approved, 'a');
    const readded = { ...without, lines: [...without.lines, line('a')] };

    expect(unapproved(setLineDiscount(readded, 'a', percent(30)))).toEqual(['a']);
  });
});
