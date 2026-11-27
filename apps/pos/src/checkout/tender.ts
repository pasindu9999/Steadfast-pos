/** What the cashier enters to take payment, and whether it is enough. Pure functions only. */
import { type Cents, changeDueCents, parseAUDToCents } from '@pos/core';

export const QUICK_TENDER_CENTS: readonly Cents[] = [2000, 5000, 10000];

/** More change than this is a typing slip, such as a barcode scanned into the amount. */
export const MAX_CHANGE_CENTS = 100_000;

const MAX_REFERENCE_LENGTH = 64;

// A whole or half-typed dollar amount.
const PARTIAL_AMOUNT = /^\d{0,7}(\.\d{0,2})?$/;

export interface Keypad {
  /** The amount in dollars, as shown. */
  text: string;
  /** Set by a quick tender: the next key replaces the amount instead of adding to it. */
  replace: boolean;
}

export const EMPTY_KEYPAD: Keypad = { text: '', replace: false };

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';

export type KeypadKey = Digit | '.' | 'backspace' | 'clear';

/** Puts in a new amount if it is one, and otherwise changes nothing. */
export function typeAmount(keypad: Keypad, text: string): Keypad {
  return PARTIAL_AMOUNT.test(text) ? { text, replace: false } : keypad;
}

export function pressKey(keypad: Keypad, key: KeypadKey): Keypad {
  if (key === 'clear') return EMPTY_KEYPAD;
  const text = keypad.replace ? '' : keypad.text;
  if (key === 'backspace') return { text: text.slice(0, -1), replace: false };
  if (key === '.') return typeAmount({ text, replace: false }, text === '' ? '0.' : `${text}.`);
  return typeAmount({ text, replace: false }, text === '0' ? key : `${text}${key}`);
}

/** The keypad after a quick tender button. */
export function amountKeypad(cents: Cents): Keypad {
  const remainder = cents % 100;
  const text = `${(cents - remainder) / 100}.${String(remainder).padStart(2, '0')}`;
  return { text, replace: true };
}

export type CashCheck =
  | { status: 'ready'; tenderedCents: Cents; changeCents: Cents }
  | { status: 'short'; remainingCents: Cents }
  | { status: 'invalid'; message: string };

/** `totalCents` is the cash total, after rounding. */
export function checkCash(text: string, totalCents: Cents): CashCheck {
  const tenderedCents = text === '' ? 0 : parseAUDToCents(text);
  if (tenderedCents === null) return { status: 'invalid', message: 'Enter an amount in dollars.' };
  if (tenderedCents < totalCents) {
    return { status: 'short', remainingCents: totalCents - tenderedCents };
  }
  const changeCents = changeDueCents(tenderedCents, totalCents);
  if (changeCents > MAX_CHANGE_CENTS) {
    return { status: 'invalid', message: 'That is far more than the total. Check the amount.' };
  }
  return { status: 'ready', tenderedCents, changeCents };
}

/** The check digit every payment card number passes. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let place = 0; place < digits.length; place += 1) {
    const digit = Number(digits[digits.length - 1 - place]);
    const doubled = place % 2 === 1 ? digit * 2 : digit;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

function looksLikeCardNumber(text: string): boolean {
  const runs = text.replace(/[\s-]/g, '').match(/\d+/g) ?? [];
  return runs.some((run) => run.length >= 13 && run.length <= 19 && passesLuhn(run));
}

export interface CardFields {
  cardReference: string | null;
  cardLast4: string | null;
}

export interface CardFieldError {
  field: 'reference' | 'last4';
  message: string;
}

/** Both fields are optional. Card numbers are never accepted, so none is stored (ARCH §11). */
export function checkCard(reference: string, last4: string): CardFields | CardFieldError {
  const cardReference = reference.trim();
  const cardLast4 = last4.trim();
  if (cardReference.length > MAX_REFERENCE_LENGTH) {
    return {
      field: 'reference',
      message: `Use at most ${MAX_REFERENCE_LENGTH} characters.`,
    };
  }
  if (looksLikeCardNumber(cardReference)) {
    return {
      field: 'reference',
      message: 'That looks like a card number. Never enter card numbers.',
    };
  }
  if (cardLast4 !== '' && !/^\d{4}$/.test(cardLast4)) {
    return { field: 'last4', message: 'Enter only the last 4 digits.' };
  }
  return { cardReference: cardReference || null, cardLast4: cardLast4 || null };
}
