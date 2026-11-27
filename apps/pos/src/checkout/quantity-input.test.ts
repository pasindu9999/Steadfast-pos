import { describe, expect, it } from 'vitest';

import { parseQuantity } from './quantity-input';

describe('parseQuantity', () => {
  it.each([
    ['1', 1],
    [' 12 ', 12],
    ['999', 999],
    ['007', 7],
  ])('reads %j', (text, qty) => {
    expect(parseQuantity(text)).toEqual({ qty });
  });

  it.each(['', '0', '1000', '-1', '1.5', '2e2', 'two', '2000000000077'])('refuses %j', (text) => {
    expect(parseQuantity(text)).toEqual({ error: 'Enter a whole number from 1 to 999.' });
  });
});
