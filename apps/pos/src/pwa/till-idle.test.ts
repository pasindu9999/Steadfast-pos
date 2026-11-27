import { describe, expect, it } from 'vitest';

import type { RegisterDialog } from '../checkout/register-store';
import { isTillIdle, type TillActivity } from './till-idle';

const IDLE: TillActivity = {
  signedIn: true,
  path: '/',
  cartLines: 0,
  committing: false,
  dialog: null,
};

/** A `Record`, so a new kind of dialog cannot be left out. */
const DIALOGS: Record<RegisterDialog['type'], true> = {
  approval: true,
  misc_item: true,
  quantity: true,
  discount: true,
  clear_sale: true,
  cash: true,
  card: true,
  parked: true,
  card_refund: true,
  void: true,
};

describe('isTillIdle', () => {
  it('is idle on an empty sale screen', () => {
    expect(isTillIdle(IDLE)).toBe(true);
  });

  it('is idle on the login screen, whatever the address', () => {
    expect(isTillIdle({ ...IDLE, signedIn: false })).toBe(true);
    expect(isTillIdle({ ...IDLE, signedIn: false, path: '/receipt/abc' })).toBe(true);
    expect(isTillIdle({ ...IDLE, signedIn: false, path: '/returns' })).toBe(true);
  });

  it('is busy while the cart has items', () => {
    expect(isTillIdle({ ...IDLE, cartLines: 1 })).toBe(false);
  });

  it('is busy while a sale is being saved', () => {
    expect(isTillIdle({ ...IDLE, committing: true })).toBe(false);
  });

  it.each(Object.keys(DIALOGS) as RegisterDialog['type'][])(
    'is busy while the %s dialog is open',
    (dialog) => {
      expect(isTillIdle({ ...IDLE, dialog })).toBe(false);
    },
  );

  it.each(['/returns', '/receipt/abc', '/return/abc'])('is busy on %s', (path) => {
    expect(isTillIdle({ ...IDLE, path })).toBe(false);
  });

  // Nothing may be lost with the page, even if no one is signed in.
  it('never counts a cart, a save or a dialog as idle', () => {
    const signedOut = { ...IDLE, signedIn: false };

    expect(isTillIdle({ ...signedOut, cartLines: 2 })).toBe(false);
    expect(isTillIdle({ ...signedOut, committing: true })).toBe(false);
    expect(isTillIdle({ ...signedOut, dialog: 'cash' })).toBe(false);
  });
});
