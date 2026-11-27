import type { PushResponse, PushResult } from '@pos/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosDatabase } from '../db/database';
import { getSetting } from '../db/settings-repo';
import { getAvailable } from '../db/stock-repo';
import type { OutboxRow } from '../db/types';
import { LINEN_ID } from '../test/checkout-fixtures';
import { outboxStatuses, terminalWithSales, unsyncedSeqs } from '../test/sync-fixtures';
import { applyPushResponse } from './apply-push';

const NOW = new Date('2026-11-20T02:00:00.000Z');

let database: PosDatabase;
let batch: OutboxRow[];

beforeEach(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  database = await terminalWithSales(3, { serverOnHand: 10 });
  batch = await database.outbox.toArray();
});

afterEach(() => vi.restoreAllMocks());

function result(seq: number, status: PushResult['status'], code?: string): PushResult {
  return {
    eventId: batch[seq - 1]!.eventId,
    seq,
    status,
    error: code ? { code, message: `${code} message` } : null,
  };
}

const response = (results: PushResult[], inventory: PushResponse['inventory'] = []) => ({
  results,
  lastAppliedSeq: 3,
  inventory,
});

const apply = (results: PushResult[], inventory?: PushResponse['inventory']) =>
  applyPushResponse(database, batch, response(results, inventory), { now: () => NOW });

describe('applyPushResponse', () => {
  it.each(['applied', 'duplicate', 'parked'] as const)(
    'marks a %s event and its movements as synced',
    async (status) => {
      const summary = await apply([result(1, status)]);

      expect(summary).toEqual({ answered: 1, synced: 1, failed: 0, seqReused: false });
      expect(await outboxStatuses(database)).toEqual(['synced', 'pending', 'pending']);
      expect(await unsyncedSeqs(database)).toEqual([2, 3]);
    },
  );

  it('keeps a rejected event as failed, with its code, and leaves its movements', async () => {
    const summary = await apply([result(1, 'rejected', 'UNKNOWN_VARIANT'), result(2, 'applied')]);

    expect(summary).toMatchObject({ answered: 2, synced: 1, failed: 1 });
    expect(await database.outbox.get(1)).toMatchObject({
      status: 'failed',
      error: { code: 'UNKNOWN_VARIANT', message: 'UNKNOWN_VARIANT message' },
      eventId: batch[0]!.eventId,
      payload: batch[0]!.payload,
    });
    expect(await unsyncedSeqs(database)).toEqual([1, 3]);
  });

  it('leaves a SEQ_REUSED event pending and saves the halt', async () => {
    const summary = await apply([result(1, 'rejected', 'SEQ_REUSED'), result(2, 'applied')]);

    expect(summary).toEqual({ answered: 1, synced: 1, failed: 0, seqReused: true });
    expect(await outboxStatuses(database)).toEqual(['pending', 'synced', 'pending']);
    expect(await unsyncedSeqs(database)).toEqual([1, 3]);
    expect(await getSetting(database, 'syncHalt')).toEqual({
      reason: 'SEQ_REUSED',
      at: NOW.toISOString(),
    });
  });

  it('takes the server stock with the acknowledgement, so nothing counts twice', async () => {
    expect(await getAvailable(database, LINEN_ID)).toBe(7);

    await apply([result(1, 'applied'), result(2, 'applied')], [{ variantId: LINEN_ID, onHand: 8 }]);

    expect((await database.inventory.get(LINEN_ID))?.serverOnHand).toBe(8);
    expect(await getAvailable(database, LINEN_ID)).toBe(7);
  });

  it('turns a resent synced event into failed if the server rejects it', async () => {
    await apply([result(1, 'applied')]);

    await apply([result(1, 'rejected', 'INVALID_PAYLOAD')]);

    expect((await database.outbox.get(1))?.status).toBe('failed');
  });

  it('never turns a failed event back into synced', async () => {
    await apply([result(1, 'rejected', 'INVALID_PAYLOAD')]);

    const summary = await apply([result(1, 'duplicate')]);

    expect(summary.synced).toBe(0);
    expect((await database.outbox.get(1))?.status).toBe('failed');
    expect(await unsyncedSeqs(database)).toEqual([1, 2, 3]);
  });

  it('ignores results for events that were not sent', async () => {
    const summary = await applyPushResponse(
      database,
      batch.slice(0, 1),
      response([result(2, 'applied'), result(3, 'applied')]),
    );

    expect(summary.answered).toBe(0);
    expect(await outboxStatuses(database)).toEqual(['pending', 'pending', 'pending']);
  });

  it('changes nothing if any step fails', async () => {
    // Stock movements are written after the outbox.
    database.stockMovements.hook('updating', () => {
      throw new Error('disk full');
    });

    await expect(
      apply([result(1, 'applied')], [{ variantId: LINEN_ID, onHand: 99 }]),
    ).rejects.toThrow();

    expect(await outboxStatuses(database)).toEqual(['pending', 'pending', 'pending']);
    expect((await database.inventory.get(LINEN_ID))?.serverOnHand).toBe(10);
  });

  it('logs the event, terminal and seq of every decision', async () => {
    await apply([result(1, 'applied'), result(2, 'rejected', 'INVALID_PAYLOAD')]);

    expect(vi.mocked(console.info).mock.calls).toEqual([
      [
        'sync event',
        {
          eventId: batch[0]!.eventId,
          terminalId: batch[0]!.terminalId,
          seq: 1,
          status: 'applied',
          code: undefined,
        },
      ],
      [
        'sync event',
        {
          eventId: batch[1]!.eventId,
          terminalId: batch[1]!.terminalId,
          seq: 2,
          status: 'rejected',
          code: 'INVALID_PAYLOAD',
        },
      ],
    ]);
  });
});
