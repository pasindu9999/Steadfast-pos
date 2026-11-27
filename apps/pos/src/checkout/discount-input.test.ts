import { describe, expect, it } from 'vitest';

import { parseDiscount } from './discount-input';

const percent = (text: string) => parseDiscount('percent', text, 8900, 'line total');
const fixed = (text: string) => parseDiscount('fixed', text, 8900, 'line total');

describe('parseDiscount, percent', () => {
  it.each([
    ['1', 1],
    ['20', 20],
    ['100', 100],
    [' 15% ', 15],
  ])('reads %j', (text, value) => {
    expect(percent(text)).toEqual({ discount: { type: 'percent', value } });
  });

  it('takes 0 as no discount', () => {
    expect(percent('0')).toEqual({ discount: null });
  });

  it.each([
    ['101', 'A discount can’t be more than 100%.'],
    ['-1', 'A discount can’t be negative.'],
    ['12.5', 'Enter a whole percentage from 0 to 100.'],
    ['', 'Enter a whole percentage from 0 to 100.'],
    ['ten', 'Enter a whole percentage from 0 to 100.'],
    ['1e2', 'Enter a whole percentage from 0 to 100.'],
  ])('refuses %j', (text, error) => {
    expect(percent(text)).toEqual({ error });
  });
});

describe('parseDiscount, dollars', () => {
  it.each([
    ['5', 500],
    ['5.00', 500],
    ['$5', 500],
    ['0.01', 1],
    ['89', 8900],
  ])('reads %j', (text, value) => {
    expect(fixed(text)).toEqual({ discount: { type: 'fixed', value } });
  });

  it('takes 0 as no discount', () => {
    expect(fixed('0.00')).toEqual({ discount: null });
  });

  it.each(['', '5.001', '-5', '10%', 'five'])('refuses %j', (text) => {
    expect(fixed(text)).toEqual({ error: 'Enter a dollar amount, such as 5 or 5.50.' });
  });

  it('refuses more than the amount it applies to', () => {
    expect(fixed('89.01')).toEqual({ error: 'That is more than the line total of $89.00.' });
  });
});
