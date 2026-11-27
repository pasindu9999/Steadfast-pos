import { describe, expect, it } from 'vitest';

import { type KeyPress, shortcutFor, type TillState } from './shortcuts';

const key = (name: string, fields: Partial<KeyPress> = {}): KeyPress => ({
  key: name,
  repeat: false,
  modified: false,
  ...fields,
});

const selling: TillState = { dialog: null, cartEmpty: false, onSaleScreen: true };
const empty: TillState = { ...selling, cartEmpty: true };
const elsewhere: TillState = { ...selling, onSaleScreen: false };

describe('shortcutFor', () => {
  it('opens payment and the cart discount on a sale', () => {
    expect(shortcutFor(key('F2'), selling)).toBe('cash');
    expect(shortcutFor(key('F3'), selling)).toBe('card');
    expect(shortcutFor(key('F4'), selling)).toBe('discount');
  });

  it('does nothing without something to sell', () => {
    for (const name of ['F2', 'F3', 'F4']) expect(shortcutFor(key(name), empty)).toBeNull();
  });

  it('means exact cash when F2 is pressed again', () => {
    expect(shortcutFor(key('F2'), { ...selling, dialog: 'cash' })).toBe('exact');
  });

  it('does nothing while another step is open', () => {
    for (const dialog of ['card', 'approval', 'discount', 'quantity', 'parked'] as const) {
      for (const name of ['F2', 'F3', 'F4', 'F8', 'Escape']) {
        expect(shortcutFor(key(name), { ...selling, dialog })).toBeNull();
      }
    }
    for (const name of ['F3', 'F4', 'F8']) {
      expect(shortcutFor(key(name), { ...selling, dialog: 'cash' })).toBeNull();
    }
  });

  it('clears the search and message with Escape when nothing is open', () => {
    expect(shortcutFor(key('Escape'), selling)).toBe('dismiss');
    expect(shortcutFor(key('Escape'), empty)).toBe('dismiss');
  });

  it('opens Returns with F8, with or without a sale, from any screen', () => {
    for (const state of [selling, empty, elsewhere]) {
      expect(shortcutFor(key('F8'), state)).toBe('returns');
    }
  });

  it('keeps payment and discount to the sale screen', () => {
    for (const name of ['F2', 'F3', 'F4']) {
      expect(shortcutFor(key(name), elsewhere)).toBeNull();
    }
    expect(shortcutFor(key('Escape'), elsewhere)).toBe('dismiss');
  });

  it('ignores a held key and keys with Ctrl, Alt or Meta', () => {
    expect(shortcutFor(key('F2', { repeat: true }), selling)).toBeNull();
    expect(shortcutFor(key('F2', { modified: true }), selling)).toBeNull();
    expect(shortcutFor(key('F4', { modified: true }), selling)).toBeNull();
  });

  it('ignores every other key', () => {
    for (const name of ['F1', 'F5', 'Enter', 'c']) {
      expect(shortcutFor(key(name), selling)).toBeNull();
    }
  });
});
