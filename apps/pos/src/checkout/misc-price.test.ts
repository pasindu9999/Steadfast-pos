import { describe, expect, it } from 'vitest';

import { MAX_MISC_PRICE_CENTS, parseMiscPrice } from './misc-price';

describe('parseMiscPrice', () => {
  it.each([
    ['0.01', 1],
    ['12.50', 1250],
    ['10000', MAX_MISC_PRICE_CENTS],
  ])('accepts %j', (text, cents) => {
    expect(parseMiscPrice(text)).toEqual({ cents });
  });

  it.each(['', '0', '0.00', '-1', 'ten', '1.234'])('refuses %j', (text) => {
    expect(parseMiscPrice(text)).toEqual({ error: 'Enter a price above $0.' });
  });

  it('refuses an unbelievable price', () => {
    expect(parseMiscPrice('10000.01')).toEqual({ error: 'Enter a price up to $10,000.' });
  });
});
