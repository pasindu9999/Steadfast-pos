import { describe, expect, it } from 'vitest';

import { pinMessage } from './pin-message';

const ZONE = 'Australia/Sydney';

describe('pinMessage', () => {
  it.each([
    [4, 'Wrong PIN. 4 attempts left.'],
    [1, 'Wrong PIN. 1 attempt left.'],
  ])('counts down to %i', (attemptsLeft, message) => {
    expect(pinMessage({ status: 'wrong_pin', attemptsLeft }, ZONE)).toBe(message);
  });

  it('says when a lock ends, in the store’s time', () => {
    const result = { status: 'locked', lockedUntil: '2026-11-27T03:05:00.000Z' } as const;

    expect(pinMessage(result, ZONE)).toBe('Too many wrong PINs. Try again after 2:05 pm.');
  });

  it('says that someone else is needed', () => {
    expect(pinMessage({ status: 'not_allowed' }, ZONE)).toBe(
      "This person can't do that. Pick someone else.",
    );
  });
});
