/** `isDeadlock` against the errors Prisma and the driver adapter really raise. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { isDeadlock } from '../src/modules/sync/retry-deadlock.js';
import { createCatalogue, resetDb, testPrisma } from './helpers/db.js';

let prisma: PrismaClient;
let ids: { store: string; terminal: string };

beforeAll(() => {
  prisma = testPrisma();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDb(prisma);
  const { store, terminal } = await createCatalogue(prisma);
  ids = { store: store.id, terminal: terminal.id };
});

type Step = (tx: Prisma.TransactionClient) => Promise<unknown>;

/** Two transactions that each take one lock, then ask for the other's. Returns what failed. */
async function deadlock(first: Step, second: Step): Promise<unknown[]> {
  let waiting = 2;
  let release!: () => void;
  const bothHoldOne = new Promise<void>((resolve) => (release = resolve));
  const run = (take: Step, then: Step) =>
    prisma.$transaction(async (tx) => {
      await take(tx);
      if (--waiting === 0) release();
      await bothHoldOne;
      await then(tx);
    });

  const results = await Promise.allSettled([run(first, second), run(second, first)]);
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
}

describe('isDeadlock', () => {
  it('recognises a deadlock in raw queries', async () => {
    const lock =
      (key: string): Step =>
      (tx) =>
        tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;

    const errors = await deadlock(lock('a'), lock('b'));

    expect(errors).toHaveLength(1);
    expect(isDeadlock(errors[0])).toBe(true);
  });

  it('recognises a deadlock in model queries', async () => {
    const errors = await deadlock(
      (tx) => tx.store.update({ where: { id: ids.store }, data: { name: 'x' } }),
      (tx) => tx.terminal.update({ where: { id: ids.terminal }, data: { receiptSeq: 1 } }),
    );

    expect(errors).toHaveLength(1);
    expect(isDeadlock(errors[0])).toBe(true);
  });

  it.each([null, undefined, new Error('boom'), { code: 'P2002', meta: { target: ['id'] } }])(
    'is false for %o',
    (error) => {
      expect(isDeadlock(error)).toBe(false);
    },
  );
});
