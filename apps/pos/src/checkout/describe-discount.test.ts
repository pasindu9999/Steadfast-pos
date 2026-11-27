import { describe, expect, it } from 'vitest';

import { discountAmount, discountSources } from './describe-discount';

describe('discountAmount', () => {
  it('writes a percentage or dollars', () => {
    expect(discountAmount({ type: 'percent', value: 25 })).toBe('25%');
    expect(discountAmount({ type: 'fixed', value: 500 })).toBe('$5.00');
  });
});

describe('discountSources', () => {
  const ten = { type: 'percent', value: 10 } as const;

  it('names the line discount', () => {
    expect(discountSources(ten, { cartDiscountCents: 0 })).toBe('10% off this line');
  });

  it('names the share of a cart discount', () => {
    expect(discountSources(undefined, { cartDiscountCents: 450 })).toBe('from the cart discount');
  });

  it('separates the two when both apply', () => {
    expect(discountSources(ten, { cartDiscountCents: 1575 })).toBe(
      '10% off this line, plus $15.75 from the cart discount',
    );
  });
});
