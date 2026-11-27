/** The push worker against the fake API: the failures of ARCH §4.5. */
import Dexie from 'dexie';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSetting } from '../db/settings-repo';
import { getAvailable } from '../db/stock-repo';
import { LINEN_ID } from '../test/checkout-fixtures';
import { createFakeSyncServer, type FakeSyncServer } from '../test/fake-sync-server';
import {
  outboxStatuses,
  sell,
  syncDeps,
  terminalWithSales,
  unsyncedSeqs,
  upTo,
} from '../test/sync-fixtures';
import { ApiRequestError } from './api-client';
import { createMemoryLockManager, createSyncLock } from './lock';
import { pushPending } from './push-pending';

let server: FakeSyncServer;

beforeAll(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
beforeEach(() => {
  server = createFakeSyncServer();
  server.state.stock.set(LINEN_ID, 200);
  server.listen();
});
afterEach(() => server.close());
afterAll(() => vi.restoreAllMocks());

const allSynced = (count: number) => upTo(count).map(() => 'synced');

/** The server has already applied this terminal's events up to `seq`. */
async function serverHas(database: Awaited<ReturnType<typeof terminalWithSales>>, seq: number) {
  await pushPending(syncDeps(database));
  const rows = await database.outbox.where('seq').above(seq).toArray();
  for (const row of rows) server.state.inbox.delete(row.eventId);
  server.state.lastAppliedSeq = seq;
  server.state.stock.set(LINEN_ID, 200 - seq);
  server.state.applied.length = seq;
  server.state.pushes.length = 0;
}

describe('pushPending: sending', () => {
  it('does nothing when there is nothing to send', async () => {
    const database = await terminalWithSales(0);

    await expect(pushPending(syncDeps(database))).resolves.toEqual({
      status: 'drained',
      sent: 0,
      failed: 0,
    });
    expect(server.state.pushes).toEqual([]);
  });

  it('sends the events without their local fields and marks them synced', async () => {
    const database = await terminalWithSales(2);

    await expect(pushPending(syncDeps(database))).resolves.toEqual({
      status: 'drained',
      sent: 2,
      failed: 0,
    });

    expect(server.state.pushes).toEqual([[1, 2]]);
    for (const event of server.state.sentEvents) {
      expect(event).not.toHaveProperty('status');
      expect(event).not.toHaveProperty('error');
    }
    expect(await outboxStatuses(database)).toEqual(allSynced(2));
    expect(await unsyncedSeqs(database)).toEqual([]);
    expect(await getAvailable(database, LINEN_ID)).toBe(198);
  });

  it('never calls the network with a database transaction open', async () => {
    const database = await terminalWithSales(60);
    const open: unknown[] = [];
    const watched: typeof fetch = (input, init) => {
      open.push(Dexie.currentTransaction ?? null);
      return fetch(input, init);
    };

    await pushPending(syncDeps(database, watched));

    expect(open).toEqual([null, null]);
  });

  it('sends a long offline backlog of 120 events as three batches, in order', async () => {
    const database = await terminalWithSales(120);

    await pushPending(syncDeps(database));

    expect(server.state.pushes.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(server.state.pushes.flat()).toEqual(upTo(120));
    expect(server.state.applied.map((event) => event.seq)).toEqual(upTo(120));
    expect(await outboxStatuses(database)).toEqual(allSynced(120));
    expect(await getAvailable(database, LINEN_ID)).toBe(80);
  });

  it('picks up a sale made during an in-flight push in the next batch', async () => {
    const database = await terminalWithSales(2);
    server.state.onPush = async () => {
      server.state.onPush = undefined;
      await sell(database);
    };

    await pushPending(syncDeps(database));

    expect(server.state.pushes).toEqual([[1, 2], [3]]);
    expect(server.state.applied.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(await outboxStatuses(database)).toEqual(allSynced(3));
    expect(await getAvailable(database, LINEN_ID)).toBe(197);
  });

  it('marks parked events as synced', async () => {
    const database = await terminalWithSales(2);
    server.state.parks.add(1);

    await pushPending(syncDeps(database));

    expect(await outboxStatuses(database)).toEqual(allSynced(2));
  });

  it('keeps a rejected event as failed, carries on, and never resends it', async () => {
    const database = await terminalWithSales(2);
    server.state.rejections.set(1, 'UNKNOWN_VARIANT');

    await expect(pushPending(syncDeps(database))).resolves.toMatchObject({ failed: 1 });
    await sell(database);
    await pushPending(syncDeps(database));

    expect(server.state.pushes).toEqual([[1, 2], [3]]);
    expect(await outboxStatuses(database)).toEqual(['failed', 'synced', 'synced']);
  });
});

describe('pushPending: lost connections and errors', () => {
  it('sends again after a drop before the commit, and applies once', async () => {
    const database = await terminalWithSales(1);
    server.state.faults.push('drop_before_commit');

    await expect(pushPending(syncDeps(database))).rejects.toMatchObject({ kind: 'network' });
    expect(await outboxStatuses(database)).toEqual(['pending']);
    await pushPending(syncDeps(database));

    expect(server.state.applied).toHaveLength(1);
    expect(await outboxStatuses(database)).toEqual(['synced']);
  });

  it('gets "duplicate" after a drop following the commit: one sale, synced once', async () => {
    const database = await terminalWithSales(2);
    server.state.faults.push('drop_after_commit');

    await expect(pushPending(syncDeps(database))).rejects.toBeInstanceOf(ApiRequestError);
    expect(server.state.applied).toHaveLength(2);
    expect(await outboxStatuses(database)).toEqual(['pending', 'pending']);

    await pushPending(syncDeps(database));

    expect(server.state.pushes).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(server.state.applied).toHaveLength(2);
    expect(await outboxStatuses(database)).toEqual(allSynced(2));
    // 200 − 2, not counted a second time on the terminal.
    expect(await getAvailable(database, LINEN_ID)).toBe(198);
  });

  it('still shows a rejection whose first answer was lost', async () => {
    const database = await terminalWithSales(1);
    server.state.rejections.set(1, 'UNKNOWN_VARIANT');
    server.state.faults.push('drop_after_commit');

    await expect(pushPending(syncDeps(database))).rejects.toThrow();
    await pushPending(syncDeps(database));

    expect(await outboxStatuses(database)).toEqual(['failed']);
  });

  it('leaves everything pending after a server error', async () => {
    const database = await terminalWithSales(2);
    server.state.faults.push('server_error');

    await expect(pushPending(syncDeps(database))).rejects.toMatchObject({ status: 500 });

    expect(await outboxStatuses(database)).toEqual(['pending', 'pending']);
    expect(await unsyncedSeqs(database)).toEqual([1, 2]);
  });

  it('gives up on a response that answers none of the events', async () => {
    const database = await terminalWithSales(1);
    let calls = 0;
    const silent: typeof fetch = () => {
      calls += 1;
      const body = { results: [], lastAppliedSeq: 0, inventory: [] };
      return Promise.resolve(new Response(JSON.stringify(body)));
    };

    await expect(pushPending(syncDeps(database, silent))).rejects.toThrow(/no event/);

    expect(calls).toBe(1);
  });

  it('refuses to run on a terminal that is not enrolled', async () => {
    const database = await terminalWithSales(1);
    await database.settings.delete('deviceToken');

    await expect(pushPending(syncDeps(database))).rejects.toThrow(/not enrolled/);
  });
});

describe('pushPending: halting', () => {
  it('halts on 401 without retrying', async () => {
    const database = await terminalWithSales(2);
    server.state.faults.push('unauthorized');

    await expect(pushPending(syncDeps(database))).resolves.toEqual({
      status: 'halted',
      reason: 'UNAUTHORIZED',
    });

    expect(server.state.pushes).toHaveLength(1);
    expect(await outboxStatuses(database)).toEqual(['pending', 'pending']);
  });

  it('halts on SEQ_REUSED, keeping the sales pending', async () => {
    // A wiped terminal: the server is at 2, these new events reuse 1 and 2.
    const database = await terminalWithSales(60);
    server.state.lastAppliedSeq = 2;

    await expect(pushPending(syncDeps(database))).resolves.toEqual({
      status: 'halted',
      reason: 'SEQ_REUSED',
    });

    expect(server.state.pushes).toHaveLength(1);
    const statuses = await outboxStatuses(database);
    expect(statuses.slice(0, 3)).toEqual(['pending', 'pending', 'synced']);
    expect(await getSetting(database, 'syncHalt')).toMatchObject({ reason: 'SEQ_REUSED' });
  });
});

describe('pushPending: 409 SEQ_GAP', () => {
  it('resends from expectedSeq, including events marked synced', async () => {
    const database = await terminalWithSales(3);
    // The server was restored from a backup that has only the first event.
    await serverHas(database, 1);
    await sell(database);

    await expect(pushPending(syncDeps(database))).resolves.toMatchObject({ status: 'drained' });

    expect(server.state.pushes).toEqual([[4], [2, 3, 4]]);
    expect(server.state.applied.map((event) => event.seq)).toEqual([1, 2, 3, 4]);
    expect(await outboxStatuses(database)).toEqual(allSynced(4));
  });

  it('resends a long range in order, batch by batch', async () => {
    const database = await terminalWithSales(120);
    await serverHas(database, 2);
    await sell(database);

    await pushPending(syncDeps(database));

    expect(server.state.pushes.map((batch) => [batch[0], batch.length])).toEqual([
      [121, 1],
      [3, 50],
      [53, 50],
      [103, 19],
    ]);
    expect(server.state.applied.map((event) => event.seq)).toEqual(upTo(121));
    expect(await outboxStatuses(database)).toEqual(allSynced(121));
  });

  it('halts when the event the server wants is no longer here', async () => {
    const database = await terminalWithSales(3);
    await serverHas(database, 1);
    await database.outbox.delete(2);
    await sell(database);

    await expect(pushPending(syncDeps(database))).resolves.toEqual({
      status: 'halted',
      reason: 'SEQ_GAP',
    });
    expect(server.state.pushes).toEqual([[4]]);
  });

  it('halts rather than resend a rejected event', async () => {
    const database = await terminalWithSales(3);
    await serverHas(database, 1);
    await database.outbox.where('seq').equals(2).modify({ status: 'failed' });
    await sell(database);

    await expect(pushPending(syncDeps(database))).resolves.toMatchObject({ reason: 'SEQ_GAP' });
    expect(server.state.pushes).toEqual([[4]]);
  });

  it('halts when the server keeps asking for the same seq', async () => {
    const database = await terminalWithSales(2);
    let calls = 0;
    const stuck: typeof fetch = () => {
      calls += 1;
      const body = { error: { code: 'SEQ_GAP', message: 'x' }, expectedSeq: 1 };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 409 }));
    };

    await expect(pushPending(syncDeps(database, stuck))).resolves.toMatchObject({
      reason: 'SEQ_GAP',
    });
    expect(calls).toBe(2);
  });
});

describe('two tabs', () => {
  it('only one worker pushes at a time, and each event is sent once', async () => {
    const database = await terminalWithSales(120);
    const locks = createMemoryLockManager();
    const tab = () => createSyncLock(locks).run(() => pushPending(syncDeps(database)));

    const outcomes = await Promise.all([tab(), tab()]);

    expect(server.state.maxInFlight).toBe(1);
    expect(server.state.pushes.flat()).toEqual(upTo(120));
    expect(outcomes).toMatchObject([{ sent: 120 }, { sent: 0 }]);
  });
});
