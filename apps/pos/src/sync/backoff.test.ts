import { describe, expect, it } from 'vitest';

import { backoffDelayMs } from './backoff';

const lowest = (attempt: number) => backoffDelayMs(attempt, () => 0);
const highest = (attempt: number) => backoffDelayMs(attempt, () => 1);

describe('backoffDelayMs', () => {
  it.each([
    [1, 500, 1_000],
    [2, 1_000, 2_000],
    [3, 2_000, 4_000],
    [6, 16_000, 32_000],
    [7, 30_000, 60_000],
    [8, 30_000, 60_000],
    [10_000, 30_000, 60_000],
  ])('waits between half and all of the step for attempt %i', (attempt, low, high) => {
    expect(lowest(attempt)).toBe(low);
    expect(highest(attempt)).toBe(high);
  });

  it('spreads retries with the random figure', () => {
    expect(backoffDelayMs(3, () => 0.5)).toBe(3_000);
  });

  it('treats an attempt below 1 as the first', () => {
    expect(highest(0)).toBe(1_000);
  });

  it('stays within bounds with real randomness', () => {
    for (let run = 0; run < 100; run += 1) {
      const delay = backoffDelayMs(1);
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(1_000);
    }
  });
});
