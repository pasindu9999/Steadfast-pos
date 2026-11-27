import { describe, expect, it } from 'vitest';

import { CheckoutError, type CheckoutFailure } from './checkout-error';
import { checkoutMessage } from './checkout-message';

describe('checkoutMessage', () => {
  const codes: CheckoutFailure[] = [
    'NOT_READY',
    'EMPTY_CART',
    'INSUFFICIENT_TENDER',
    'INVALID_SALE',
  ];

  it('words every refusal for the cashier', () => {
    const messages = codes.map((code) =>
      checkoutMessage(new CheckoutError(code, 'lines.0.skuSnapshot')),
    );

    expect(new Set(messages).size).toBe(codes.length);
    for (const message of messages) {
      expect(message).not.toMatch(/[A-Z]_[A-Z]|skuSnapshot|Error/);
    }
  });

  it('says the sale was not saved when storage fails', () => {
    const message = checkoutMessage(new Error('UnknownError: internal'));

    expect(message).toMatch(/not saved/i);
    expect(message).toMatch(/do not charge .* twice/i);
    expect(message).not.toContain('internal');
  });

  it('says so when the device is full, however the error is wrapped', () => {
    const quota = Object.assign(new Error('x'), { name: 'QuotaExceededError' });
    const wrapped = Object.assign(new Error('y'), { name: 'AbortError', inner: quota });

    expect(checkoutMessage(quota)).toMatch(/storage is full/i);
    expect(checkoutMessage(wrapped)).toMatch(/storage is full/i);
  });
});
