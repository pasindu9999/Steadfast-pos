/** The P2-8 acceptance scenarios (ARCH §4.4, §4.5, §5). */
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { startApp, type TestApp } from './helpers/app.js';
import { resetDb, testPrisma } from './helpers/db.js';
import { returnEvent, saleEvent } from './helpers/events.js';
import { createShop, ledgerSum, onHand, type Shop } from './helpers/shop.js';
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
  shop = await createShop(prisma, { stock: 1 });
});

const lastAppliedSeq = async (terminalId: string) =>
  Number((await prisma.terminal.findUniqueOrThrow({ where: { id: terminalId } })).lastAppliedSeq);

describe('sync acceptance', () => {
  it('applies a duplicate push once', async () => {
    const sale = saleEvent(shop, shop.t1, { seq: 1 });

    expect(await pushOutcomes(app, shop.t1, [sale])).toEqual(['applied']);
    const retry = await pushOk(app, shop.t1, [sale]);

    expect(retry.results).toEqual([
      { eventId: sale.eventId, seq: 1, status: 'duplicate', error: null },
    ]);
    expect(retry.lastAppliedSeq).toBe(1);
    expect(retry.inventory).toEqual([{ variantId: shop.variant.id, onHand: 0 }]);
    expect(await prisma.sale.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.stockMovement.count({ where: { reason: 'sale' } })).toBe(1);
    expect(await onHand(prisma, shop)).toBe(0);
  });

  it('answers 409 with expectedSeq for a gap and applies the resend', async () => {
    const first = saleEvent(shop, shop.t1, { seq: 1 });
    const second = saleEvent(shop, shop.t1, { seq: 2 });

    const gap = await push(app, shop.t1, [second]);

    expect(gap.status).toBe(409);
    expect(errorCode(gap.body)).toBe('SEQ_GAP');
    expect(expectedSeqOf(gap.body)).toBe(1);
    expect(await prisma.syncInbox.count()).toBe(0);
    expect(await prisma.sale.count()).toBe(0);
    expect(await pushOutcomes(app, shop.t1, [first, second])).toEqual(['applied', 'applied']);
  });

  it('rejects a reused seq without storing anything', async () => {
    const original = saleEvent(shop, shop.t1, { seq: 1 });
    await pushOk(app, shop.t1, [original]);
    const reused = saleEvent(shop, shop.t1, { seq: 1, receiptSeq: 2 });

    expect(await pushOutcomes(app, shop.t1, [reused])).toEqual(['rejected:SEQ_REUSED']);

    expect(await prisma.sale.count()).toBe(1);
    expect(await prisma.syncInbox.count()).toBe(1);
    expect(await lastAppliedSeq(shop.t1.id)).toBe(1);
    expect(await onHand(prisma, shop)).toBe(0);
  });

  it(
    'keeps both sales of the last shirt: stock −1 and one open discrepancy',
    { repeats: 4 },
    async () => {
      const first = saleEvent(shop, shop.t1, { seq: 1 });
      const second = saleEvent(shop, shop.t2, { seq: 1 });

      const outcomes = await Promise.all([
        pushOutcomes(app, shop.t1, [first]),
        pushOutcomes(app, shop.t2, [second]),
      ]);

      expect(outcomes).toEqual([['applied'], ['applied']]);
      expect(await prisma.sale.count()).toBe(2);
      expect(await onHand(prisma, shop)).toBe(-1);
      expect(await ledgerSum(prisma, shop)).toBe(-1);
      const discrepancies = await prisma.stockDiscrepancy.findMany();
      expect(discrepancies).toMatchObject([
        { variantId: shop.variant.id, status: 'open', onHandAtDetection: -1 },
      ]);
      expect([first.eventId, second.eventId]).toContain(discrepancies[0]!.triggerEventId);
    },
  );

  it('parks a return until its sale arrives, then applies it', async () => {
    // Sold on T1, which is still offline; returned on T2 from the receipt's QR code.
    const sale = saleEvent(shop, shop.t1, { seq: 1 });
    const returned = returnEvent(shop, shop.t2, sale, { seq: 1 });

    expect(await pushOutcomes(app, shop.t2, [returned])).toEqual(['parked']);
    expect(await prisma.saleReturn.count()).toBe(0);
    expect(await onHand(prisma, shop)).toBe(1);
    expect(await lastAppliedSeq(shop.t2.id)).toBe(1);

    expect(await pushOutcomes(app, shop.t1, [sale])).toEqual(['applied']);

    expect(await prisma.saleReturn.findMany()).toMatchObject([
      { id: returned.payload.returnId, originalSaleId: sale.payload.saleId },
    ]);
    const parked = await prisma.syncInbox.findUniqueOrThrow({
      where: { eventId: returned.eventId },
    });
    expect(parked.status).toBe('applied');
    expect(parked.appliedAt).not.toBeNull();
    expect(await onHand(prisma, shop)).toBe(1);
    expect(await ledgerSum(prisma, shop)).toBe(1);
  });

  it('applies a parked part return, restocking only what is not damaged', async () => {
    const sale = saleEvent(shop, shop.t1, { seq: 1, lines: [{ qty: 2 }, { qty: 1 }] });
    const whole = returnEvent(shop, shop.t2, sale, {
      seq: 1,
      qtys: [
        [1, 1],
        [2, 1],
      ],
    });
    // One unit of line 1 goes back on the shelf; line 2 came back damaged.
    const lines = whole.payload.lines.map((line) => ({ ...line, restock: line.saleLineNo === 1 }));
    const returned = { ...whole, payload: { ...whole.payload, lines } };

    expect(await pushOutcomes(app, shop.t2, [returned])).toEqual(['parked']);
    expect(await prisma.stockMovement.count({ where: { reason: 'return' } })).toBe(0);
    expect(await pushOutcomes(app, shop.t1, [sale])).toEqual(['applied']);

    const stored = await prisma.returnLine.findMany({
      include: { saleLine: { select: { lineNo: true } } },
      orderBy: { saleLine: { lineNo: 'asc' } },
    });
    expect(stored).toMatchObject([
      { qty: 1, restock: true, saleLine: { lineNo: 1 } },
      { qty: 1, restock: false, saleLine: { lineNo: 2 } },
    ]);
    expect(await prisma.stockMovement.findMany({ where: { reason: 'return' } })).toMatchObject([
      { delta: 1, sourceId: returned.payload.returnId, terminalId: shop.t2.id },
    ]);
    // One in stock, three sold, one back.
    expect(await onHand(prisma, shop)).toBe(-1);
    expect(await ledgerSum(prisma, shop)).toBe(-1);
  });

  it('rejects a return of more than was sold', async () => {
    const sale = saleEvent(shop, shop.t1, { seq: 1 });
    await pushOk(app, shop.t1, [sale]);
    const first = returnEvent(shop, shop.t1, sale, { seq: 2, returnSeq: 1 });
    // T2 doesn't know about the first return.
    const second = returnEvent(shop, shop.t2, sale, { seq: 1 });

    expect(await pushOutcomes(app, shop.t1, [first])).toEqual(['applied']);
    expect(await pushOutcomes(app, shop.t2, [second])).toEqual(['rejected:OVER_RETURN']);

    expect(await prisma.saleReturn.count()).toBe(1);
    expect(await prisma.refund.count()).toBe(1);
    expect(await onHand(prisma, shop)).toBe(1);
    const inbox = await prisma.syncInbox.findUniqueOrThrow({ where: { eventId: second.eventId } });
    expect(inbox).toMatchObject({ status: 'rejected', seq: 1n });
    expect(inbox.error).toContain('OVER_RETURN');
  });

  it('rejects an invalid payload and lets the queue advance', async () => {
    const broken = {
      ...saleEvent(shop, shop.t1, { seq: 1 }),
      eventId: uuidv7(),
      payload: { saleId: 'not-a-sale' },
    };
    const good = saleEvent(shop, shop.t1, { seq: 2 });

    expect(await pushOutcomes(app, shop.t1, [broken, good])).toEqual([
      'rejected:INVALID_PAYLOAD',
      'applied',
    ]);

    expect(await lastAppliedSeq(shop.t1.id)).toBe(2);
    expect(await prisma.sale.count()).toBe(1);
    const inbox = await prisma.syncInbox.findUniqueOrThrow({ where: { eventId: broken.eventId } });
    expect(inbox).toMatchObject({ status: 'rejected', payload: { saleId: 'not-a-sale' } });
  });
});
