import { syncEventSchema } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { terminalWithSales, upTo } from '../test/sync-fixtures';
import { getOutboxSummary, readBatchFrom, readPendingBatch, toSyncEvent } from './outbox-repo';
import type { OutboxRow } from './types';

const seqs = (rows: OutboxRow[]) => rows.map((row) => row.seq);

describe('readPendingBatch', () => {
  it('returns pending events in ascending seq, up to the limit', async () => {
    const database = await terminalWithSales(6);
    await database.outbox.where('seq').equals(1).modify({ status: 'synced' });
    await database.outbox.where('seq').equals(3).modify({ status: 'failed' });
    // Updated last: the order must come from the seq, not from the writes.
    await database.outbox.where('seq').equals(2).modify({ status: 'pending' });

    expect(seqs(await readPendingBatch(database, 3))).toEqual([2, 4, 5]);
  });

  it('takes 50 by default', async () => {
    const database = await terminalWithSales(51);

    expect(seqs(await readPendingBatch(database))).toEqual(upTo(50));
  });
});

describe('readBatchFrom', () => {
  it('includes synced events from that seq, never failed ones', async () => {
    const database = await terminalWithSales(5);
    await database.outbox.where('seq').anyOf(1, 2, 3).modify({ status: 'synced' });
    await database.outbox.where('seq').equals(4).modify({ status: 'failed' });

    expect(seqs(await readBatchFrom(database, 2, 10))).toEqual([2, 3, 5]);
    expect(seqs(await readBatchFrom(database, 2, 2))).toEqual([2, 3]);
    expect(await readBatchFrom(database, 6)).toEqual([]);
  });
});

describe('getOutboxSummary', () => {
  it('is empty for a new terminal', async () => {
    await expect(getOutboxSummary(await terminalWithSales(0))).resolves.toEqual({
      pending: 0,
      oldestPendingAt: null,
      failed: [],
    });
  });

  it('counts what is waiting, with the time of the oldest', async () => {
    const database = await terminalWithSales(4);
    await database.outbox.where('seq').equals(1).modify({ status: 'synced' });
    const second = await database.outbox.get(2);

    await expect(getOutboxSummary(database)).resolves.toMatchObject({
      pending: 3,
      oldestPendingAt: second!.occurredAt,
    });
  });

  it('lists rejected receipts with their numbers and codes', async () => {
    const database = await terminalWithSales(3);
    await database.outbox
      .where('seq')
      .equals(2)
      .modify({ status: 'failed', error: { code: 'UNKNOWN_VARIANT', message: 'x' } });
    await database.outbox.where('seq').equals(3).modify({ status: 'failed' });

    await expect(getOutboxSummary(database)).resolves.toMatchObject({
      pending: 1,
      failed: [
        { seq: 2, number: 'S01-T1-000002', code: 'UNKNOWN_VARIANT' },
        { seq: 3, number: 'S01-T1-000003', code: null },
      ],
    });
  });
});

describe('toSyncEvent', () => {
  it('strips the local fields and keeps the event exactly', async () => {
    const database = await terminalWithSales(1);
    const [row] = await database.outbox.toArray();

    const event = toSyncEvent({ ...row!, error: { code: 'INVALID_PAYLOAD', message: 'x' } });

    expect(event).not.toHaveProperty('status');
    expect(event).not.toHaveProperty('error');
    expect(event).toEqual(syncEventSchema.parse(row));
  });
});
