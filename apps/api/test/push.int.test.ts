/** The push protocol itself (ARCH §4.4). What each event does is in `appliers.int.test.ts`. */
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { startApp, type TestApp } from './helpers/app.js';
import { resetDb, testPrisma } from './helpers/db.js';
import { returnEvent, saleEvent } from './helpers/events.js';
import { createShop, type Shop } from './helpers/shop.js';
import { errorCode, expectedSeqOf, push, pushOk, pushOutcomes } from './helpers/sync.js';

let prisma: PrismaClient;
let app: TestApp;
let shop: Shop;

beforeAll(async () => {
  prisma = testPrisma();
  app = await startApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb(prisma);
  shop = await createShop(prisma, { stock: 100 });
});

const sale = (seq: number) => saleEvent(shop, shop.t1, { seq });

const terminalRow = (id = shop.t1.id) => prisma.terminal.findUniqueOrThrow({ where: { id } });

const inboxRow = (eventId: string) => prisma.syncInbox.findUniqueOrThrow({ where: { eventId } });

const expectNothingWritten = async () => {
  expect(await prisma.syncInbox.count()).toBe(0);
  expect(await prisma.sale.count()).toBe(0);
  expect(await terminalRow()).toMatchObject({ lastAppliedSeq: 0n, lastSeenAt: null });
};

/** Fails the transaction at its last write, after the event's effects. */
async function withFailingTerminalUpdate(
  condition: string,
  errcode: string,
  run: () => Promise<void>,
) {
  await prisma.$executeRawUnsafe(`CREATE SEQUENCE test_failures`);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ${condition} THEN RAISE EXCEPTION 'injected failure' USING ERRCODE = '${errcode}'; END IF;
      RETURN NEW;
    END $$`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER test_fail BEFORE UPDATE ON terminals
    FOR EACH ROW EXECUTE FUNCTION test_fail()`);
  try {
    await run();
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER test_fail ON terminals`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION test_fail()`);
    await prisma.$executeRawUnsafe(`DROP SEQUENCE test_failures`);
  }
}

describe('POST /v1/sync/push: who may send what', () => {
  it.each([undefined, 'x'.repeat(43)])('answers 401 for the token %o', async (token) => {
    const response = await push(app, { ...shop.t1, token: token ?? '' }, [sale(1)]);

    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('UNAUTHORIZED');
    await expectNothingWritten();
  });

  it('answers 403 when the body names another terminal', async () => {
    const response = await app.request('/v1/sync/push', {
      token: shop.t1.token,
      json: { terminalId: shop.t2.id, events: [sale(1)] },
    });

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('TERMINAL_MISMATCH');
    await expectNothingWritten();
  });

  it('rejects an event that names another terminal', async () => {
    const foreign = { ...sale(1), terminalId: shop.t2.id };

    expect(await pushOutcomes(app, shop.t1, [foreign])).toEqual(['rejected:TERMINAL_MISMATCH']);

    expect(await prisma.sale.count()).toBe(0);
    expect(await inboxRow(foreign.eventId)).toMatchObject({
      terminalId: shop.t1.id,
      status: 'rejected',
    });
    expect((await terminalRow(shop.t2.id)).lastAppliedSeq).toBe(0n);
  });
});

describe('batch validation', () => {
  it.each([
    ['no events', () => []],
    ['51 events', () => Array.from({ length: 51 }, (_, index) => sale(index + 1))],
    ['descending seq', () => [sale(2), sale(1)]],
    ['a repeated seq', () => [sale(1), sale(1)]],
    ['an event id that is not a UUIDv7', () => [{ ...sale(1), eventId: 'abc' }]],
    ['an event without seq', () => [{ ...sale(1), seq: undefined }]],
  ])('answers 400 for %s and writes nothing', async (_, events) => {
    const response = await push(app, shop.t1, events());

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    await expectNothingWritten();
  });
});

describe('sequence rules', () => {
  it('keeps the events before a gap', async () => {
    const first = sale(1);

    const response = await push(app, shop.t1, [first, sale(3)]);

    expect(response.status).toBe(409);
    expect(expectedSeqOf(response.body)).toBe(2);
    expect(await prisma.syncInbox.findMany()).toMatchObject([
      { eventId: first.eventId, status: 'applied' },
    ]);
    expect((await terminalRow()).lastAppliedSeq).toBe(1n);
  });

  it('records an applied event', async () => {
    const event = sale(1);

    const response = await pushOk(app, shop.t1, [event]);

    expect(response).toMatchObject({
      results: [{ eventId: event.eventId, seq: 1, status: 'applied', error: null }],
      lastAppliedSeq: 1,
    });
    const row = await inboxRow(event.eventId);
    expect(row).toMatchObject({
      terminalId: shop.t1.id,
      seq: 1n,
      type: 'SALE_COMPLETED',
      status: 'applied',
      error: null,
      payload: event.payload,
      occurredAt: new Date(event.occurredAt),
    });
    expect(row.appliedAt).toBeInstanceOf(Date);
    expect((await terminalRow()).lastSeenAt).toBeInstanceOf(Date);
  });

  it('changes nothing when the whole batch is sent again', async () => {
    const events = [sale(1), sale(2)];
    await pushOk(app, shop.t1, events);
    const before = { terminal: await terminalRow(), inbox: await prisma.syncInbox.findMany() };

    expect(await pushOutcomes(app, shop.t1, events)).toEqual(['duplicate', 'duplicate']);

    expect(await terminalRow()).toEqual(before.terminal);
    expect(await prisma.syncInbox.findMany()).toEqual(before.inbox);
  });

  it('applies the new events of an overlapping resend', async () => {
    const [first, second, third] = [sale(1), sale(2), sale(3)];
    await pushOk(app, shop.t1, [first, second]);

    expect(await pushOutcomes(app, shop.t1, [second, third])).toEqual(['duplicate', 'applied']);
  });

  it('applies each event once when the same batch arrives twice at once', async () => {
    const events = Array.from({ length: 8 }, (_, index) => sale(index + 1));

    const [a, b] = await Promise.all([
      pushOutcomes(app, shop.t1, events),
      pushOutcomes(app, shop.t1, events),
    ]);

    for (const [index, outcome] of a.entries()) {
      expect([outcome, b[index]].sort()).toEqual(['applied', 'duplicate']);
    }
    expect(await prisma.syncInbox.count()).toBe(8);
    expect((await terminalRow()).lastAppliedSeq).toBe(8n);
  });

  it('writes nothing for a reused seq', async () => {
    await pushOk(app, shop.t1, [sale(1), sale(2)]);
    const before = await terminalRow();
    const reused = saleEvent(shop, shop.t1, { seq: 1, receiptSeq: 900 });

    expect(await pushOutcomes(app, shop.t1, [reused])).toEqual(['rejected:SEQ_REUSED']);

    expect(await terminalRow()).toEqual(before);
    expect(await prisma.syncInbox.count()).toBe(2);
  });

  it('keeps each terminal on its own sequence', async () => {
    await pushOk(app, shop.t1, [sale(1)]);

    expect(await pushOutcomes(app, shop.t2, [saleEvent(shop, shop.t2, { seq: 1 })])).toEqual([
      'applied',
    ]);
  });
});

describe('events the server cannot accept', () => {
  const deeplyNested = () => {
    let value: unknown = 'bottom';
    for (let depth = 0; depth < 1000; depth += 1) value = [value];
    return value;
  };

  it.each([
    ['an unknown type', { type: 'STOCK_COUNTED' }, 'UNSUPPORTED_EVENT'],
    ['a newer schema version', { schemaVersion: 2 }, 'UNSUPPORTED_EVENT'],
    ['no payload', { payload: undefined }, 'INVALID_PAYLOAD'],
    ['a payload of the wrong shape', { payload: [1, 2] }, 'INVALID_PAYLOAD'],
    ['a NUL in the type', { type: 'SALE\u0000' }, 'UNSUPPORTED_EVENT'],
    ['a NUL in the payload', { payload: { note: 'a\u0000b' } }, 'INVALID_PAYLOAD'],
    ['a NUL in a key', { payload: { 'a\u0000': 1 } }, 'INVALID_PAYLOAD'],
    ['half a surrogate pair', { payload: { note: '\ud800' } }, 'INVALID_PAYLOAD'],
    ['a very deep payload', { payload: deeplyNested() }, 'INVALID_PAYLOAD'],
    ['a time the database cannot hold', { occurredAt: '0000-01-01T00:00:00Z' }, 'INVALID_PAYLOAD'],
  ])('stores %s as rejected and moves on', async (_, override, code) => {
    const bad = { ...sale(1), ...override };

    expect(await pushOutcomes(app, shop.t1, [bad, sale(2)])).toEqual([
      `rejected:${code}`,
      'applied',
    ]);

    const row = await inboxRow(bad.eventId);
    expect(row).toMatchObject({ status: 'rejected', appliedAt: null });
    expect(row.error).toContain(code);
    expect(await prisma.syncInbox.count({ where: { status: 'applied' } })).toBe(1);
    expect((await terminalRow()).lastAppliedSeq).toBe(2n);
  });

  it('keeps a readable copy of an unstorable payload', async () => {
    const event = sale(1);
    const bad = { ...event, payload: { ...event.payload, note: 'a\u0000b' } };

    await pushOk(app, shop.t1, [bad]);

    expect((await inboxRow(bad.eventId)).payload).toEqual({ ...event.payload, note: 'a�b' });
  });

  it('reports where a payload is invalid without repeating it', async () => {
    const event = sale(1);
    const bad = { ...event, payload: { ...event.payload, receiptNo: 'private-text' } };

    const { results } = await pushOk(app, shop.t1, [bad]);

    expect(results[0]!.error!.message).toContain('payload.receiptNo');
    expect(results[0]!.error!.message).not.toContain('private-text');
  });
});

describe('receipt and return counters (ARCH §4.3)', () => {
  const counters = async () => {
    const { receiptSeq, returnSeq } = await terminalRow();
    return { receiptSeq, returnSeq };
  };

  it('follow the highest number seen and never go back', async () => {
    const high = saleEvent(shop, shop.t1, { seq: 1, receiptSeq: 40 });
    const low = saleEvent(shop, shop.t1, { seq: 2, receiptSeq: 12 });
    const returned = returnEvent(shop, shop.t1, high, { seq: 3, returnSeq: 7 });

    await pushOk(app, shop.t1, [high, low, returned]);

    expect(await counters()).toEqual({ receiptSeq: 40n, returnSeq: 7n });
  });

  it('count the number on a rejected event, so it is never printed twice', async () => {
    const bad = { ...sale(1), payload: { receiptNo: 'S01-T1-000055' } };

    await pushOk(app, shop.t1, [bad]);

    expect(await counters()).toEqual({ receiptSeq: 55n, returnSeq: 0n });
  });

  it('ignore numbers that belong to another terminal or store', async () => {
    const events = ['S01-T2-000055', 'S02-T1-000055', 'nonsense'].map((receiptNo, index) => ({
      ...sale(index + 1),
      payload: { receiptNo, returnNo: `R-${receiptNo}` },
    }));

    await pushOk(app, shop.t1, events);

    expect(await counters()).toEqual({ receiptSeq: 0n, returnSeq: 0n });
  });
});

describe('transactions', () => {
  it('rolls an event back completely when it fails, so the retry applies it', async () => {
    const events = [sale(1), sale(2)];

    await withFailingTerminalUpdate('NEW.last_applied_seq = 2', 'P0001', async () => {
      const response = await push(app, shop.t1, events);

      expect(response.status).toBe(500);
      expect(errorCode(response.body)).toBe('INTERNAL_ERROR');
      expect(await prisma.syncInbox.count()).toBe(1);
      expect((await terminalRow()).lastAppliedSeq).toBe(1n);
      expect(await prisma.sale.count()).toBeLessThanOrEqual(1);
    });

    expect(await pushOutcomes(app, shop.t1, events)).toEqual(['duplicate', 'applied']);
  });

  it('retries an event up to three times after a deadlock', async () => {
    await withFailingTerminalUpdate("nextval('test_failures') <= 3", '40P01', async () => {
      expect(await pushOutcomes(app, shop.t1, [sale(1)])).toEqual(['applied']);
    });
    expect(await prisma.syncInbox.count()).toBe(1);
  });

  it('gives up after the third retry', async () => {
    await withFailingTerminalUpdate("nextval('test_failures') <= 4", '40P01', async () => {
      expect((await push(app, shop.t1, [sale(1)])).status).toBe(500);
    });
    await expectNothingWritten();
  });
});

describe('size and logging', () => {
  it('accepts a full batch far over 100 kB', async () => {
    const events = Array.from({ length: 50 }, (_, index) =>
      saleEvent(shop, shop.t1, { seq: index + 1, lines: Array.from({ length: 10 }, () => ({})) }),
    );
    expect(JSON.stringify(events).length).toBeGreaterThan(100_000);

    const response = await pushOk(app, shop.t1, events);

    expect(response.results.every((result) => result.status === 'applied')).toBe(true);
    expect(response.lastAppliedSeq).toBe(50);
  });

  it('logs each decision without the payload', async () => {
    const event = sale(1);
    app.logs.length = 0;

    await pushOk(app, shop.t1, [event]);
    await pushOk(app, shop.t1, [event]);

    const decisions = app.logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.eventId === event.eventId);
    expect(decisions).toMatchObject([
      { terminalId: shop.t1.id, seq: 1, status: 'applied' },
      { terminalId: shop.t1.id, seq: 1, status: 'duplicate' },
    ]);
    expect(app.logs.join('')).not.toContain(event.payload.receiptNo);
    expect(app.logs.join('')).not.toContain(shop.t1.token);
  });

  it('lets an unknown event id through as a new event', async () => {
    await pushOk(app, shop.t1, [sale(1)]);

    expect(await pushOutcomes(app, shop.t1, [{ ...sale(2), eventId: uuidv7() }])).toEqual([
      'applied',
    ]);
  });
});
