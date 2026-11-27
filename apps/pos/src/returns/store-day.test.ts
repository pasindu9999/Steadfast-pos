import { describe, expect, it } from 'vitest';

import { isSameStoreDay } from './store-day';

const SYDNEY = 'Australia/Sydney';

describe('isSameStoreDay', () => {
  it.each([
    ['a minute either side of midnight', '2026-11-26T12:59:00Z', '2026-11-26T13:01:00Z', false],
    ['the whole of one day', '2026-11-26T13:00:00Z', '2026-11-27T12:59:59Z', true],
    ['a day that spans two UTC dates', '2026-11-26T21:00:00Z', '2026-11-27T06:00:00Z', true],
    ['the same UTC date but two store days', '2026-11-27T01:00:00Z', '2026-11-27T14:00:00Z', false],
    ['the short day when summer time starts', '2026-10-03T14:00:00Z', '2026-10-04T12:59:00Z', true],
    ['the long day when summer time ends', '2026-04-04T13:00:00Z', '2026-04-05T13:59:00Z', true],
    ['the same time a year apart', '2025-11-27T02:00:00Z', '2026-11-27T02:00:00Z', false],
  ])('is %s: %s and %s → %s', (_, first, second, same) => {
    expect(isSameStoreDay(new Date(first), new Date(second), SYDNEY)).toBe(same);
  });

  it('judges by the store’s time zone, not the device’s', () => {
    const first = new Date('2026-11-26T12:59:00Z');
    const second = new Date('2026-11-26T13:01:00Z');

    expect(isSameStoreDay(first, second, 'UTC')).toBe(true);
  });
});
