import { describe, expect, it } from 'vitest';

import { type VoidCheck, voidRefusal } from './void-rules';

const check = (fields: Partial<VoidCheck> = {}): VoidCheck => ({
  sale: { terminalId: 'T1', status: 'completed', occurredAt: '2026-11-27T01:00:00.000Z' },
  terminalId: 'T1',
  hasReturns: false,
  now: new Date('2026-11-27T05:00:00.000Z'),
  timeZone: 'Australia/Sydney',
  ...fields,
});

const sale = check().sale!;

describe('voidRefusal', () => {
  it('allows a sale of this terminal, today, with nothing returned', () => {
    expect(voidRefusal(check())).toBeNull();
  });

  it.each([
    ['another terminal’s sale', { terminalId: 'T2' }, 'OTHER_TERMINAL'],
    ['a sale that is not stored here', { sale: undefined }, 'OTHER_TERMINAL'],
    ['a voided sale', { sale: { ...sale, status: 'voided' as const } }, 'ALREADY_VOIDED'],
    ['a sale with a return', { hasReturns: true }, 'HAS_RETURNS'],
    ['yesterday’s sale', { now: new Date('2026-11-27T13:00:00.000Z') }, 'NOT_TODAY'],
    ['a sale dated tomorrow', { now: new Date('2026-11-26T05:00:00.000Z') }, 'NOT_TODAY'],
  ])('refuses %s', (_, fields, refusal) => {
    expect(voidRefusal(check(fields))).toBe(refusal);
  });
});
