import { syncEventSchema } from '@pos/core';
import { describe, expect, it } from 'vitest';

import { terminalWithSales, upTo } from '../test/sync-fixtures';
import { readBatchFrom, readPendingBatch, toSyncEvent } from './outbox-repo';
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
