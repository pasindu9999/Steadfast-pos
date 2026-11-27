import { describe, expect, it } from 'vitest';

import { type KeyPress, shortcutFor, type TillState } from './shortcuts';

const key = (name: string, fields: Partial<KeyPress> = {}): KeyPress => ({
  key: name,
  repeat: false,
  modified: false,
  ...fields,
});

const selling: TillState = { dialog: null, cartEmpty: false };
const empty: TillState = { dialog: null, cartEmpty: true };

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
    expect(shortcutFor(key('F2'), { dialog: 'cash', cartEmpty: false })).toBe('exact');
  });

  it('does nothing while another step is open', () => {
    for (const dialog of ['card', 'approval', 'discount', 'quantity', 'parked'] as const) {
      for (const name of ['F2', 'F3', 'F4', 'Escape']) {
        expect(shortcutFor(key(name), { dialog, cartEmpty: false })).toBeNull();
      }
    }
    for (const name of ['F3', 'F4']) {
      expect(shortcutFor(key(name), { dialog: 'cash', cartEmpty: false })).toBeNull();
    }
  });

  it('clears the search and message with Escape when nothing is open', () => {
    expect(shortcutFor(key('Escape'), selling)).toBe('dismiss');
    expect(shortcutFor(key('Escape'), empty)).toBe('dismiss');
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
