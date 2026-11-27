import { describe, expect, it } from 'vitest';

import {
  amountKeypad,
  checkCard,
  checkCash,
  EMPTY_KEYPAD,
  type Keypad,
  type KeypadKey,
  MAX_CHANGE_CENTS,
  pressKey,
  QUICK_TENDER_CENTS,
  typeAmount,
} from './tender';

const press = (keys: KeypadKey[], from: Keypad = EMPTY_KEYPAD) => keys.reduce(pressKey, from).text;
const digits = (text: string) => [...text] as KeypadKey[];

describe('keypad', () => {
  it('types dollars, and cents after the point', () => {
    expect(press(digits('50'))).toBe('50');
    expect(press(digits('50.25'))).toBe('50.25');
  });

  it('starts a leading point with a zero', () => {
    expect(press(digits('.5'))).toBe('0.5');
  });

  it('keeps no leading zeros', () => {
    expect(press(digits('007'))).toBe('7');
    expect(press(digits('0.05'))).toBe('0.05');
  });

  it('takes one point and two decimals', () => {
    expect(press(digits('1..2.345'))).toBe('1.23');
  });

  it('stops at seven digits of dollars', () => {
    expect(press(digits('123456789'))).toBe('1234567');
    expect(press(digits('123456789.50'))).toBe('1234567.50');
  });

  it('deletes the last character, and clears', () => {
    expect(press(['1', '2', 'backspace'])).toBe('1');
    expect(press(['backspace'])).toBe('');
    expect(press(['1', '2', 'clear'])).toBe('');
  });
});

describe('quick tender', () => {
  it('offers $20, $50 and $100', () => {
    expect(QUICK_TENDER_CENTS).toEqual([2000, 5000, 10000]);
  });

  it('writes the amount in dollars and cents', () => {
    expect(amountKeypad(2000).text).toBe('20.00');
    expect(amountKeypad(15710).text).toBe('157.10');
    expect(amountKeypad(5).text).toBe('0.05');
    expect(amountKeypad(0).text).toBe('0.00');
  });

  it('is replaced by the next digit, not added to', () => {
    expect(press(['7'], amountKeypad(2000))).toBe('7');
    expect(press(['.'], amountKeypad(2000))).toBe('0.');
    expect(press(['backspace'], amountKeypad(2000))).toBe('');
    expect(press(['7', '5'], amountKeypad(2000))).toBe('75');
  });
});

describe('typing the amount', () => {
  it('accepts an amount, even half typed', () => {
    for (const text of ['', '5', '50.', '50.2', '.5']) {
      expect(typeAmount(EMPTY_KEYPAD, text).text).toBe(text);
    }
  });

  it('ignores anything else', () => {
    const before = press(digits('50'));
    for (const text of ['50a', '-50', '50.123', '1 000', '12345678', 'LIN-BLK-M']) {
      expect(typeAmount({ text: before, replace: false }, text).text).toBe('50');
    }
  });

  it('ends the replacing that a quick tender started', () => {
    const typed = typeAmount(amountKeypad(2000), '3');
    expect(press(['0'], typed)).toBe('30');
  });
});

describe('checkCash', () => {
  it('gives change', () => {
    expect(checkCash('200', 15710)).toEqual({
      status: 'ready',
      tenderedCents: 20000,
      changeCents: 4290,
    });
  });

  it('accepts the exact amount', () => {
    expect(checkCash('157.10', 15710)).toMatchObject({ status: 'ready', changeCents: 0 });
  });

  it('says how much is missing, down to one cent', () => {
    expect(checkCash('157.09', 15710)).toEqual({ status: 'short', remainingCents: 1 });
    expect(checkCash('', 15710)).toEqual({ status: 'short', remainingCents: 15710 });
  });

  it('needs no cash for a sale that costs nothing', () => {
    expect(checkCash('', 0)).toEqual({ status: 'ready', tenderedCents: 0, changeCents: 0 });
  });

  it('refuses a point on its own', () => {
    expect(checkCash('.', 0)).toMatchObject({ status: 'invalid' });
  });

  it('refuses an amount far over the total, such as a scanned barcode', () => {
    const limit = 15710 + MAX_CHANGE_CENTS;
    expect(checkCash('1157.10', 15710)).toMatchObject({ status: 'ready', tenderedCents: limit });
    expect(checkCash('1157.11', 15710)).toMatchObject({ status: 'invalid' });
    expect(checkCash('2000000', 15710)).toMatchObject({ status: 'invalid' });
  });
});

describe('checkCard', () => {
  it('needs neither field', () => {
    expect(checkCard('', '  ')).toEqual({ cardReference: null, cardLast4: null });
  });

  it('trims what was typed', () => {
    expect(checkCard(' 000123 ', ' 4242 ')).toEqual({
      cardReference: '000123',
      cardLast4: '4242',
    });
  });

  it('wants exactly four digits', () => {
    for (const last4 of ['123', '12345', '12a4', '4111111111111111']) {
      expect(checkCard('', last4)).toMatchObject({ field: 'last4' });
    }
  });

  it('limits the reference to 64 characters', () => {
    expect(checkCard('a'.repeat(64), '')).toMatchObject({ cardReference: 'a'.repeat(64) });
    expect(checkCard('a'.repeat(65), '')).toMatchObject({ field: 'reference' });
  });

  it('refuses a card number in the reference, however it is spaced', () => {
    for (const reference of [
      '4111111111111111',
      '4111 1111 1111 1111',
      '4111-1111-1111-1111',
      'ref 5555555555554444',
      '378282246310005',
      '4222222222222',
    ]) {
      expect(checkCard(reference, '')).toMatchObject({ field: 'reference' });
    }
  });

  it('allows other long numbers', () => {
    // Sixteen digits that fail the card check digit, and a short number that passes it.
    expect(checkCard('4111111111111112', '')).toHaveProperty('cardReference');
    expect(checkCard('424242424242', '')).toHaveProperty('cardReference');
  });
});
