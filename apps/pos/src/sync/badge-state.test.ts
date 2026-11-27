import { describe, expect, it } from 'vitest';

import { type BadgeInput, badgeState, STALE_AFTER_MS } from './badge-state';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const healthy: BadgeInput = {
  pending: 0,
  failed: 0,
  oldestPendingAt: null,
  halt: null,
  reachable: true,
  storage: 'persisted',
  now: NOW,
};

const waiting = (pending: number, fields: Partial<BadgeInput> = {}): BadgeInput => ({
  ...healthy,
  pending,
  oldestPendingAt: ago(60_000),
  ...fields,
});

const shown = (input: BadgeInput) => {
  const { tone, label } = badgeState(input);
  return [tone, label];
};

describe('badgeState (ARCH §4.8)', () => {
  it.each([
    ['all synced', healthy, ['green', 'Online · All synced']],
    ['events waiting', waiting(3), ['blue', 'Syncing · 3']],
    [
      'offline with sales',
      waiting(4, { reachable: false }),
      ['amber', 'Offline · 4 unsynced receipts'],
    ],
    [
      'offline with one sale',
      waiting(1, { reachable: false }),
      ['amber', 'Offline · 1 unsynced receipt'],
    ],
    ['offline with nothing', { ...healthy, reachable: false }, ['amber', 'Offline']],
    ['not yet checked', { ...healthy, reachable: null }, ['grey', 'Checking connection']],
    ['not yet checked, with sales', waiting(2, { reachable: null }), ['blue', 'Syncing · 2']],
  ])('shows %s', (_, input, expected) => {
    expect(shown(input)).toEqual(expected);
    expect(badgeState(input).reasons).toEqual([]);
  });

  describe('needs attention', () => {
    const red = ['red', 'Needs attention'];

    it.each([
      ['UNAUTHORIZED', /no longer accepts this terminal/i],
      ['TERMINAL_MISMATCH', /another terminal/i],
      ['SEQ_REUSED', /set up again/i],
      ['SEQ_GAP', /missing sales/i],
    ] as const)('after a halt: %s', (halt, reason) => {
      // Whatever else is true, including never having reached the server.
      for (const reachable of [true, false, null]) {
        const state = badgeState({ ...healthy, halt, reachable });
        expect([state.tone, state.label]).toEqual(red);
        expect(state.reasons.join(' ')).toMatch(reason);
      }
    });

    it.each([
      [1, '1 receipt was refused by the server.'],
      [2, '2 receipts were refused by the server.'],
    ])('with %i rejected', (failed, reason) => {
      const state = badgeState({ ...healthy, failed, reachable: false });

      expect([state.tone, state.label]).toEqual(red);
      expect(state.reasons).toEqual([reason]);
    });

    it('once the oldest unsynced event is more than 2 hours old', () => {
      const at = (age: number) => waiting(2, { reachable: false, oldestPendingAt: ago(age) });

      expect(STALE_AFTER_MS).toBe(2 * 60 * 60 * 1000);
      expect(shown(at(STALE_AFTER_MS))).toEqual(['amber', 'Offline · 2 unsynced receipts']);
      expect(shown(at(STALE_AFTER_MS + 1))).toEqual(red);
      expect(badgeState(at(STALE_AFTER_MS + 1)).reasons.join(' ')).toMatch(/over 2 hours/);
    });

    it('lists every reason at once', () => {
      const state = badgeState({
        ...waiting(1, { oldestPendingAt: ago(STALE_AFTER_MS * 2) }),
        failed: 1,
        halt: 'UNAUTHORIZED',
        storage: 'denied',
      });

      expect(state.reasons).toHaveLength(4);
    });
  });

  describe('storage that is not persisted', () => {
    const warning = /may delete saved data/i;

    it.each(['denied', 'unsupported'] as const)(
      'turns the badge red when %s, with events waiting and the server reachable',
      (storage) => {
        const state = badgeState(waiting(1, { storage }));

        expect(state.tone).toBe('red');
        expect(state.reasons.join(' ')).toMatch(warning);
      },
    );

    it.each([
      ['offline with sales', waiting(3, { reachable: false }), 'amber'],
      ['everything sent', healthy, 'green'],
      ['not yet checked', waiting(3, { reachable: null }), 'blue'],
    ])('only warns while %s', (_, input, tone) => {
      const state = badgeState({ ...input, storage: 'denied' });

      expect(state.tone).toBe(tone);
      expect(state.reasons.join(' ')).toMatch(warning);
    });

    it('says nothing before the browser has answered', () => {
      expect(badgeState(waiting(1, { storage: 'unknown' }))).toMatchObject({
        tone: 'blue',
        reasons: [],
      });
    });
  });
});
