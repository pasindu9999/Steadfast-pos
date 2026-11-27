import { describe, expect, it } from 'vitest';

import { hashPin, isValidPin, PIN_HASH_ITERATIONS, verifyPin } from './pin.js';

const SALT = Uint8Array.from({ length: 16 }, (_, index) => index);
const FAST = { iterations: 1000 };
const VECTOR =
  'pbkdf2-sha256$1000$000102030405060708090a0b0c0d0e0f$' +
  '01210802eda9e5f1c121969bef80236ee3839131d7794b4af881d95a09242e60';

describe('isValidPin', () => {
  it.each(['1111', '000000', '12345678'])('accepts %s', (pin) => {
    expect(isValidPin(pin)).toBe(true);
  });

  it.each(['', '123', '123456789', '12a4', ' 1234', '12.4', '١٢٣٤'])('rejects "%s"', (pin) => {
    expect(isValidPin(pin)).toBe(false);
  });
});

describe('hashPin', () => {
  it('produces the standard PBKDF2-SHA256 result', async () => {
    await expect(hashPin('1111', { ...FAST, salt: SALT })).resolves.toBe(VECTOR);
  });

  it('uses a random 16-byte salt and the default iteration count', async () => {
    const first = await hashPin('9999');
    const second = await hashPin('9999');

    expect(first).toMatch(
      new RegExp(`^pbkdf2-sha256\\$${PIN_HASH_ITERATIONS}\\$[0-9a-f]{32}\\$[0-9a-f]{64}$`),
    );
    expect(first).not.toBe(second);
  });

  it.each(['', '123', 'abcd'])('throws for the PIN "%s"', async (pin) => {
    await expect(hashPin(pin, FAST)).rejects.toThrow(RangeError);
  });

  it.each([0, -1, 1.5, 10_000_001])('throws for %s iterations', async (iterations) => {
    await expect(hashPin('1111', { iterations })).rejects.toThrow(RangeError);
  });
});

describe('verifyPin', () => {
  it('accepts the right PIN only', async () => {
    await expect(verifyPin('1111', VECTOR)).resolves.toBe(true);
    await expect(verifyPin('1112', VECTOR)).resolves.toBe(false);
  });

  it('verifies a hash made with the defaults', async () => {
    const hash = await hashPin('9999');

    await expect(verifyPin('9999', hash)).resolves.toBe(true);
    await expect(verifyPin('1111', hash)).resolves.toBe(false);
  });

  it('is false for an invalid PIN', async () => {
    await expect(verifyPin('abc', VECTOR)).resolves.toBe(false);
  });

  const [, , salt = '', digest = ''] = VECTOR.split('$');

  it.each([
    '',
    'not a hash',
    `pbkdf2-sha1$1000$${salt}$${digest}`,
    `pbkdf2-sha256$0$${salt}$${digest}`,
    `pbkdf2-sha256$99999999999$${salt}$${digest}`,
    `pbkdf2-sha256$1000$$${digest}`,
    `pbkdf2-sha256$1000$zz$${digest}`,
    `pbkdf2-sha256$1000$abc$${digest}`,
    `pbkdf2-sha256$1000$${salt}$${digest.slice(2)}`,
    `${VECTOR}$extra`,
  ])('is false for the malformed hash "%s"', async (stored) => {
    await expect(verifyPin('1111', stored)).resolves.toBe(false);
  });
});
