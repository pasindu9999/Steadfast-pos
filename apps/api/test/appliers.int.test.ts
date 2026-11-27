/** What each event does to the database (ARCH §4.1, §5). */
import type { ReturnCompletedEvent, SaleCompletedEvent } from '@pos/core';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { startApp, type TestApp } from './helpers/app.js';
import { resetDb, testPrisma } from './helpers/db.js';
import { returnEvent, saleEvent, voidEvent } from './helpers/events.js';
import { addVariant, createShop, ledgerSum, onHand, type Shop } from './helpers/shop.js';
import { pushOk, pushOutcomes } from './helpers/sync.js';

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
  shop = await createShop(prisma, { stock: 10 });
});

const storedSale = (event: SaleCompletedEvent) =>
  prisma.sale.findUniqueOrThrow({
    where: { id: event.payload.saleId },
    include: { lines: { orderBy: { lineNo: 'asc' } }, payments: true },
  });

const inboxRow = (eventId: string) => prisma.syncInbox.findUniqueOrThrow({ where: { eventId } });

const movements = (reason: string) =>
  prisma.stockMovement.findMany({ where: { reason }, orderBy: { delta: 'asc' } });

/** A sale of `qty` shirts on T1, already synced. */
async function soldOnT1(qty = 1, seq = 1) {
  const sale = saleEvent(shop, shop.t1, { seq, lines: [{ qty }] });
  expect(await pushOutcomes(app, shop.t1, [sale])).toEqual(['applied']);
  return sale;
}

function withPayload<E extends { payload: object }>(event: E, change: Partial<E['payload']>): E {
  return { ...event, payload: { ...event.payload, ...change } };
}

async function expectNoSaleEffects() {
  expect(await prisma.sale.count()).toBe(0);
  expect(await prisma.saleLine.count()).toBe(0);
  expect(await prisma.payment.count()).toBe(0);
  expect(await movements('sale')).toEqual([]);
  expect(await onHand(prisma, shop)).toBe(10);
}

async function createOtherStore() {
  const store = await prisma.store.create({
    data: { id: uuidv7(), code: 'S02', name: 'Second Store' },
  });
  const staff = await prisma.staff.create({
    data: { id: uuidv7(), storeId: store.id, name: 'Robin', role: 'cashier', pinHash: 'x' },
  });
  return { store, staff };
}

describe('SALE_COMPLETED', () => {
  it('stores the sale, its lines, payments and stock movements', async () => {
    const large = await addVariant(prisma, shop, 'L', 5);
    const sale = saleEvent(shop, shop.t1, {
      seq: 1,
      tender: 'card',
      cartDiscount: { type: 'percent', value: 10 },
      lines: [{ qty: 2 }, { variantId: large.id, qty: 1, discount: { type: 'fixed', value: 500 } }],
    });

    const response = await pushOk(app, shop.t1, [sale]);

    const { lines, payments, saleId, occurredAt, ...header } = {
      ...sale.payload,
      occurredAt: sale.occurredAt,
    };
    const stored = await storedSale(sale);
    expect(stored).toMatchObject({
      ...header,
      id: saleId,
      terminalId: shop.t1.id,
      status: 'completed',
      occurredAt: new Date(occurredAt),
      flags: [],
    });
    expect(stored.lines).toMatchObject(
      lines.map((line) => ({
        id: line.lineId,
        lineNo: line.lineNo,
        variantId: line.variantId,
        skuSnapshot: line.skuSnapshot,
        nameSnapshot: line.nameSnapshot,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        lineDiscountCents: line.lineDiscountCents,
        taxCents: line.taxCents,
        lineTotalCents: line.lineTotalCents,
      })),
    );
    expect(stored.payments).toMatchObject(
      payments.map(({ paymentId, ...payment }) => ({ ...payment, id: paymentId })),
    );
    expect(await movements('sale')).toMatchObject(
      [
        { variantId: shop.variant.id, delta: -2 },
        { variantId: large.id, delta: -1 },
      ].map((movement) => ({
        ...movement,
        storeId: shop.store.id,
        sourceType: 'sale',
        sourceId: saleId,
        terminalId: shop.t1.id,
        staffId: shop.staff.id,
        occurredAt: new Date(occurredAt),
      })),
    );
    expect(response.inventory).toEqual(
      [
        { variantId: shop.variant.id, onHand: 8 },
        { variantId: large.id, onHand: 4 },
      ].sort((a, b) => a.variantId.localeCompare(b.variantId)),
    );
  });

  it('moves stock once per line and adds the lines of one variant together', async () => {
    const sale = saleEvent(shop, shop.t1, { seq: 1, lines: [{ qty: 2 }, { qty: 3 }] });

    await pushOk(app, shop.t1, [sale]);

    expect(await movements('sale')).toMatchObject([{ delta: -3 }, { delta: -2 }]);
    expect(await onHand(prisma, shop)).toBe(5);
  });

  it('creates the stock level for a variant that never had one', async () => {
    const unstocked = await addVariant(prisma, shop, 'XL');

    await pushOk(app, shop.t1, [
      saleEvent(shop, shop.t1, { seq: 1, lines: [{ variantId: unstocked.id }] }),
    ]);

    expect(await onHand(prisma, shop, unstocked.id)).toBe(-1);
    expect(await prisma.stockDiscrepancy.count()).toBe(1);
  });

  it('still applies a sale of an archived variant (ARCH §5.4)', async () => {
    await prisma.productVariant.update({
      where: { id: shop.variant.id },
      data: { isActive: false },
    });

    await soldOnT1();
  });

  it.each([
    [
      'total_mismatch',
      (sale: SaleCompletedEvent) =>
        withPayload(sale, { totalCents: sale.payload.totalCents - 100 }),
    ],
    ['price_drift', () => saleEvent(shop, shop.t1, { seq: 1, lines: [{ unitPriceCents: 7900 }] })],
    [
      'clock_skew',
      () =>
        saleEvent(shop, shop.t1, {
          seq: 1,
          occurredAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
    ],
    ['unknown_staff', (sale: SaleCompletedEvent) => withPayload(sale, { staffId: uuidv7() })],
  ])('accepts a sale and flags %s', async (flag, change) => {
    const sale = change(saleEvent(shop, shop.t1, { seq: 1 }));

    expect(await pushOutcomes(app, shop.t1, [sale])).toEqual(['applied']);

    expect((await storedSale(sale)).flags).toEqual([flag]);
    expect(await onHand(prisma, shop)).toBe(9);
  });

  it('accepts a sale too large to price', async () => {
    const sale = saleEvent(shop, shop.t1, { seq: 1 });
    const [line] = sale.payload.lines;
    const huge = withPayload(sale, {
      lines: [{ ...line!, qty: 2_000_000_000, unitPriceCents: 2_000_000_000 }],
    });

    expect(await pushOutcomes(app, shop.t1, [huge])).toEqual(['applied']);

    expect((await storedSale(huge)).flags).toContain('total_mismatch');
  });

  it('drops a staff member of another store', async () => {
    const { staff } = await createOtherStore();
    const sale = withPayload(saleEvent(shop, shop.t1, { seq: 1 }), { staffId: staff.id });

    await pushOk(app, shop.t1, [sale]);

    expect(await storedSale(sale)).toMatchObject({ staffId: null, flags: ['unknown_staff'] });
    expect(await movements('sale')).toMatchObject([{ staffId: null }]);
  });

  it('raises no flag for a sale without a staff member', async () => {
    const sale = withPayload(saleEvent(shop, shop.t1, { seq: 1 }), { staffId: null });

    await pushOk(app, shop.t1, [sale]);

    expect(await storedSale(sale)).toMatchObject({ staffId: null, flags: [] });
  });

  it.each([
    [
      'STORE_MISMATCH',
      async (sale: SaleCompletedEvent) =>
        withPayload(sale, { storeId: (await createOtherStore()).store.id }),
    ],
    [
      'RECEIPT_MISMATCH',
      (sale: SaleCompletedEvent) => withPayload(sale, { receiptNo: 'S01-T2-000001' }),
    ],
    [
      'UNKNOWN_VARIANT',
      (sale: SaleCompletedEvent) =>
        withPayload(sale, { lines: [{ ...sale.payload.lines[0]!, variantId: uuidv7() }] }),
    ],
  ])('rejects %s and writes nothing', async (code, change) => {
    const sale = await change(saleEvent(shop, shop.t1, { seq: 1 }));

    expect(await pushOutcomes(app, shop.t1, [sale])).toEqual([`rejected:${code}`]);

    await expectNoSaleEffects();
    expect((await inboxRow(sale.eventId)).status).toBe('rejected');
  });

  it.each([
    [
      'DUPLICATE_ID',
      'the sale id',
      (first: SaleCompletedEvent) => ({ saleId: first.payload.saleId }),
    ],
    [
      'DUPLICATE_RECEIPT',
      'the receipt number',
      (first: SaleCompletedEvent) => ({ receiptNo: first.payload.receiptNo }),
    ],
    [
      'DUPLICATE_ID',
      'a line id',
      (first: SaleCompletedEvent, next: SaleCompletedEvent) => ({
        lines: [{ ...next.payload.lines[0]!, lineId: first.payload.lines[0]!.lineId }],
      }),
    ],
    [
      'DUPLICATE_ID',
      'a payment id',
      (first: SaleCompletedEvent, next: SaleCompletedEvent) => ({
        payments: [
          { ...next.payload.payments[0]!, paymentId: first.payload.payments[0]!.paymentId },
        ],
      }),
    ],
  ])('rejects %s when a new sale reuses %s', async (code, _, reuse) => {
    const first = await soldOnT1();
    const next = saleEvent(shop, shop.t1, { seq: 2 });

    const outcomes = await pushOutcomes(app, shop.t1, [withPayload(next, reuse(first, next))]);

    expect(outcomes).toEqual([`rejected:${code}`]);
    expect(await prisma.sale.count()).toBe(1);
    expect(await prisma.payment.count()).toBe(1);
    expect(await onHand(prisma, shop)).toBe(9);
  });
});

describe('quantities too large for the stock columns', () => {
  const maxed = (seq: number, lines = 1) => {
    const sale = saleEvent(shop, shop.t1, {
      seq,
      lines: Array.from({ length: lines }, () => ({})),
    });
    return withPayload(sale, {
      lines: sale.payload.lines.map((line) => ({ ...line, qty: 2_147_483_647 })),
    });
  };

  it('rejects a sale whose own lines add up too high, and moves on', async () => {
    const next = saleEvent(shop, shop.t1, { seq: 2 });

    expect(await pushOutcomes(app, shop.t1, [maxed(1, 2), next])).toEqual([
      'rejected:INVALID_PAYLOAD',
      'applied',
    ]);

    expect(await prisma.sale.count()).toBe(1);
    expect(await movements('sale')).toMatchObject([{ delta: -1 }]);
    expect(await onHand(prisma, shop)).toBe(9);
  });

  it('rejects a sale that would push the stock level out of range', async () => {
    expect(await pushOutcomes(app, shop.t1, [maxed(1), maxed(2)])).toEqual([
      'applied',
      'rejected:INVALID_PAYLOAD',
    ]);

    expect(await prisma.sale.count()).toBe(1);
    expect(await onHand(prisma, shop)).toBe(10 - 2_147_483_647);
  });
});

describe('stock discrepancies (ARCH §5.2)', () => {
  it('raises none while stock stays at zero or above', async () => {
    await soldOnT1(10);

    expect(await onHand(prisma, shop)).toBe(0);
    expect(await prisma.stockDiscrepancy.count()).toBe(0);
  });

  it('keeps one open row, and opens another once it is resolved', async () => {
    const first = await soldOnT1(11);
    await soldOnT1(1, 2);

    expect(await prisma.stockDiscrepancy.findMany()).toMatchObject([
      { status: 'open', onHandAtDetection: -1, triggerEventId: first.eventId },
    ]);

    await prisma.stockDiscrepancy.updateMany({ data: { status: 'resolved' } });
    await soldOnT1(1, 3);

    expect(await prisma.stockDiscrepancy.findMany({ where: { status: 'open' } })).toMatchObject([
      { onHandAtDetection: -3 },
    ]);
  });

  it('is not raised by a return that leaves stock negative', async () => {
    const sale = await soldOnT1(12);
    await prisma.stockDiscrepancy.updateMany({ data: { status: 'resolved' } });

    await pushOk(app, shop.t1, [
      returnEvent(shop, shop.t1, sale, { seq: 2, returnSeq: 1, qtys: [[1, 1]] }),
    ]);

    expect(await onHand(prisma, shop)).toBe(-1);
    expect(await prisma.stockDiscrepancy.count({ where: { status: 'open' } })).toBe(0);
  });

  it(
    'lets terminals sell the same variants in opposite order at once',
    { repeats: 5 },
    async () => {
      const large = await addVariant(prisma, shop, 'L', 1);
      const sales = (terminal: Shop['t1'], variantIds: string[]) =>
        Array.from({ length: 5 }, (_, index) =>
          saleEvent(shop, terminal, {
            seq: index + 1,
            lines: variantIds.map((variantId) => ({ variantId })),
          }),
        );

      await Promise.all([
        pushOk(app, shop.t1, sales(shop.t1, [shop.variant.id, large.id])),
        pushOk(app, shop.t2, sales(shop.t2, [large.id, shop.variant.id])),
      ]);

      expect(await onHand(prisma, shop)).toBe(0);
      expect(await onHand(prisma, shop, large.id)).toBe(-9);
      expect(await ledgerSum(prisma, shop, large.id)).toBe(-9);
      expect(await prisma.stockDiscrepancy.count()).toBe(1);
    },
  );
});

describe('SALE_VOIDED', () => {
  it('marks the sale voided and puts the stock back', async () => {
    const sale = await soldOnT1(3);
    const voided = voidEvent(shop.t1, sale, { seq: 2 });

    const response = await pushOk(app, shop.t1, [voided]);

    expect(response.results).toMatchObject([{ status: 'applied' }]);
    expect(response.inventory).toEqual([{ variantId: shop.variant.id, onHand: 10 }]);
    expect(await storedSale(sale)).toMatchObject({
      status: 'voided',
      voidedAt: new Date(voided.occurredAt),
      voidReason: 'Rung up twice',
    });
    expect(await movements('void')).toMatchObject([
      { delta: 3, sourceType: 'sale', sourceId: sale.payload.saleId, terminalId: shop.t1.id },
    ]);
    expect(await ledgerSum(prisma, shop)).toBe(10);
  });

  const expectRefused = async (
    terminal: Shop['t1'],
    event: ReturnType<typeof voidEvent>,
    code: string,
  ) => {
    const before = await onHand(prisma, shop);
    expect(await pushOutcomes(app, terminal, [event])).toEqual([`rejected:${code}`]);
    expect(await onHand(prisma, shop)).toBe(before);
  };

  it('refuses a sale the server does not have', async () => {
    const unsynced = saleEvent(shop, shop.t1, { seq: 1 });

    await expectRefused(shop.t1, voidEvent(shop.t1, unsynced, { seq: 1 }), 'UNKNOWN_SALE');
  });

  it('refuses a sale made on another terminal', async () => {
    const sale = await soldOnT1();

    await expectRefused(shop.t2, voidEvent(shop.t2, sale, { seq: 1 }), 'SALE_NOT_VOIDABLE');
  });

  it('refuses a receipt number that does not match the sale', async () => {
    const sale = await soldOnT1();
    const event = withPayload(voidEvent(shop.t1, sale, { seq: 2 }), {
      receiptNo: 'S01-T1-000999',
    });

    await expectRefused(shop.t1, event, 'RECEIPT_MISMATCH');
  });

  it('refuses a second void', async () => {
    const sale = await soldOnT1();
    await pushOk(app, shop.t1, [voidEvent(shop.t1, sale, { seq: 2 })]);

    await expectRefused(shop.t1, voidEvent(shop.t1, sale, { seq: 3 }), 'SALE_VOIDED');
    expect(await movements('void')).toHaveLength(1);
  });

  it('refuses a sale that has returns', async () => {
    const sale = await soldOnT1(2);
    await pushOk(app, shop.t1, [
      returnEvent(shop, shop.t1, sale, { seq: 2, returnSeq: 1, qtys: [[1, 1]] }),
    ]);

    await expectRefused(shop.t1, voidEvent(shop.t1, sale, { seq: 3 }), 'SALE_NOT_VOIDABLE');
    expect((await storedSale(sale)).status).toBe('completed');
  });
});

describe('RETURN_COMPLETED', () => {
  const returnOnT2 = (sale: SaleCompletedEvent, qty = 1, seq = 1) =>
    returnEvent(shop, shop.t2, sale, { seq, qtys: [[1, qty]] });

  const storedReturn = (event: ReturnCompletedEvent) =>
    prisma.saleReturn.findUniqueOrThrow({
      where: { id: event.payload.returnId },
      include: { lines: true, refunds: true },
    });

  it('stores the return, its lines, refunds and restock movements', async () => {
    const sale = await soldOnT1(3);
    const returned = returnOnT2(sale, 2);

    const response = await pushOk(app, shop.t2, [returned]);

    const { lines, refunds, returnId, ...header } = returned.payload;
    const stored = await storedReturn(returned);
    expect(stored).toMatchObject({
      ...header,
      id: returnId,
      terminalId: shop.t2.id,
      occurredAt: new Date(returned.occurredAt),
    });
    expect(stored.lines).toMatchObject([
      {
        id: lines[0]!.returnLineId,
        saleLineId: sale.payload.lines[0]!.lineId,
        qty: 2,
        refundCents: lines[0]!.refundCents,
        restock: true,
      },
    ]);
    expect(stored.refunds).toMatchObject([
      { id: refunds[0]!.refundId, method: 'cash', amountCents: refunds[0]!.amountCents },
    ]);
    expect(await movements('return')).toMatchObject([
      { delta: 2, sourceType: 'return', sourceId: returnId, terminalId: shop.t2.id },
    ]);
    expect(response.inventory).toEqual([{ variantId: shop.variant.id, onHand: 9 }]);
  });

  it('allows the rest to be returned later, and no more', async () => {
    const sale = await soldOnT1(3);

    expect(await pushOutcomes(app, shop.t2, [returnOnT2(sale, 1)])).toEqual(['applied']);
    expect(
      await pushOutcomes(app, shop.t2, [
        returnEvent(shop, shop.t2, sale, { seq: 2, qtys: [[1, 2]], returned: [[1, 1]] }),
      ]),
    ).toEqual(['applied']);
    expect(await pushOutcomes(app, shop.t2, [returnOnT2(sale, 1, 3)])).toEqual([
      'rejected:OVER_RETURN',
    ]);

    const { _sum } = await prisma.returnLine.aggregate({ _sum: { qty: true, refundCents: true } });
    expect(_sum).toEqual({ qty: 3, refundCents: sale.payload.totalCents });
    expect(await onHand(prisma, shop)).toBe(10);
  });

  it('lets only one of two terminals return the last unit', { repeats: 5 }, async () => {
    const sale = await soldOnT1(1);
    const onFirst = returnEvent(shop, shop.t1, sale, { seq: 2, returnSeq: 1 });

    const outcomes = await Promise.all([
      pushOutcomes(app, shop.t1, [onFirst]),
      pushOutcomes(app, shop.t2, [returnOnT2(sale)]),
    ]);

    expect(outcomes.flat().sort()).toEqual(['applied', 'rejected:OVER_RETURN']);
    expect(await prisma.saleReturn.count()).toBe(1);
    expect(await onHand(prisma, shop)).toBe(10);
  });

  it('moves no stock for damaged goods', async () => {
    const sale = await soldOnT1(2);
    const damaged = returnEvent(shop, shop.t2, sale, { seq: 1, restock: false });

    expect(await pushOutcomes(app, shop.t2, [damaged])).toEqual(['applied']);

    expect(await movements('return')).toEqual([]);
    expect(await onHand(prisma, shop)).toBe(8);
    expect((await storedReturn(damaged)).lines).toMatchObject([{ restock: false }]);
  });

  it('drops an unknown staff member', async () => {
    const sale = await soldOnT1();
    const returned = withPayload(returnOnT2(sale), { staffId: uuidv7() });

    await pushOk(app, shop.t2, [returned]);

    expect((await storedReturn(returned)).staffId).toBeNull();
  });

  it.each([
    [
      'UNKNOWN_SALE_LINE',
      (event: ReturnCompletedEvent) =>
        withPayload(event, { lines: [{ ...event.payload.lines[0]!, saleLineNo: 9 }] }),
    ],
    [
      'INVALID_PAYLOAD',
      (event: ReturnCompletedEvent) =>
        withPayload(event, { lines: [{ ...event.payload.lines[0]!, variantId: uuidv7() }] }),
    ],
    ['STORE_MISMATCH', (event: ReturnCompletedEvent) => withPayload(event, { storeId: uuidv7() })],
    [
      'RECEIPT_MISMATCH',
      (event: ReturnCompletedEvent) => withPayload(event, { returnNo: 'R-S01-T1-000001' }),
    ],
  ])('rejects %s and writes nothing', async (code, change) => {
    const sale = await soldOnT1();

    expect(await pushOutcomes(app, shop.t2, [change(returnOnT2(sale))])).toEqual([
      `rejected:${code}`,
    ]);

    expect(await prisma.saleReturn.count()).toBe(0);
    expect(await onHand(prisma, shop)).toBe(9);
  });

  it.each([
    ['DUPLICATE_ID', (first: ReturnCompletedEvent) => ({ returnId: first.payload.returnId })],
    ['DUPLICATE_RECEIPT', (first: ReturnCompletedEvent) => ({ returnNo: first.payload.returnNo })],
    [
      'DUPLICATE_ID',
      (first: ReturnCompletedEvent, next: ReturnCompletedEvent) => ({
        lines: [{ ...next.payload.lines[0]!, returnLineId: first.payload.lines[0]!.returnLineId }],
      }),
    ],
    [
      'DUPLICATE_ID',
      (first: ReturnCompletedEvent, next: ReturnCompletedEvent) => ({
        refunds: [{ ...next.payload.refunds[0]!, refundId: first.payload.refunds[0]!.refundId }],
      }),
    ],
  ])('rejects %s for a reused value', async (code, reuse) => {
    const sale = await soldOnT1(3);
    const first = returnOnT2(sale, 1);
    await pushOk(app, shop.t2, [first]);
    const next = returnOnT2(sale, 1, 2);

    const outcomes = await pushOutcomes(app, shop.t2, [withPayload(next, reuse(first, next))]);

    expect(outcomes).toEqual([`rejected:${code}`]);
    expect(await prisma.saleReturn.count()).toBe(1);
  });

  it('rejects a return of a voided sale', async () => {
    const sale = await soldOnT1();
    await pushOk(app, shop.t1, [voidEvent(shop.t1, sale, { seq: 2 })]);

    expect(await pushOutcomes(app, shop.t2, [returnOnT2(sale)])).toEqual(['rejected:SALE_VOIDED']);
    expect(await onHand(prisma, shop)).toBe(10);
  });
});

describe('parked returns (ARCH §4.4 step 7)', () => {
  const unsyncedSale = (qty = 1, seq = 1) => saleEvent(shop, shop.t1, { seq, lines: [{ qty }] });

  const statuses = async () => {
    const rows = await prisma.syncInbox.findMany({
      where: { type: 'RETURN_COMPLETED' },
      orderBy: [{ terminalId: 'asc' }, { seq: 'asc' }],
    });
    return rows.map((row) => row.status);
  };

  it('applies them in arrival order and rejects the one that returns too much', async () => {
    const sale = unsyncedSale(1);
    const first = returnEvent(shop, shop.t2, sale, { seq: 1 });
    const second = returnEvent(shop, shop.t2, sale, { seq: 2 });
    expect(await pushOutcomes(app, shop.t2, [first])).toEqual(['parked']);
    expect(await pushOutcomes(app, shop.t2, [second])).toEqual(['parked']);

    const response = await pushOk(app, shop.t1, [sale]);

    expect(response.results).toMatchObject([{ status: 'applied' }]);
    expect(response.inventory).toEqual([{ variantId: shop.variant.id, onHand: 10 }]);
    expect(await inboxRow(first.eventId)).toMatchObject({ status: 'applied', error: null });
    const refused = await inboxRow(second.eventId);
    expect(refused).toMatchObject({ status: 'rejected', appliedAt: null });
    expect(refused.error).toContain('OVER_RETURN');
    expect(await prisma.saleReturn.count()).toBe(1);
    expect(await ledgerSum(prisma, shop)).toBe(10);
    expect(await movements('return')).toMatchObject([{ terminalId: shop.t2.id }]);
  });

  it('still answers duplicate when a parked return is sent again', async () => {
    const returned = returnEvent(shop, shop.t2, unsyncedSale(), { seq: 1 });
    await pushOk(app, shop.t2, [returned]);

    expect(await pushOutcomes(app, shop.t2, [returned])).toEqual(['duplicate']);
  });

  it('answers a resent parked return that was later refused with the refusal', async () => {
    const sale = unsyncedSale(1);
    const first = returnEvent(shop, shop.t2, sale, { seq: 1 });
    const second = returnEvent(shop, shop.t2, sale, { seq: 2 });
    await pushOk(app, shop.t2, [first, second]);
    await pushOk(app, shop.t1, [sale]);

    expect(await pushOutcomes(app, shop.t2, [first, second])).toEqual([
      'duplicate',
      'rejected:OVER_RETURN',
    ]);
  });

  it('leaves a return parked when its sale is rejected', async () => {
    const sale = unsyncedSale();
    await pushOk(app, shop.t2, [returnEvent(shop, shop.t2, sale, { seq: 1 })]);

    const outcomes = await pushOutcomes(app, shop.t1, [
      withPayload(sale, { receiptNo: 'S01-T2-000001' }),
    ]);

    expect(outcomes).toEqual(['rejected:RECEIPT_MISMATCH']);
    expect(await statuses()).toEqual(['parked']);
  });

  it('never leaves a return parked when it races its sale', { repeats: 15 }, async () => {
    const sale = unsyncedSale();
    const returned = returnEvent(shop, shop.t2, sale, { seq: 1 });

    await Promise.all([pushOk(app, shop.t1, [sale]), pushOk(app, shop.t2, [returned])]);

    expect(await statuses()).toEqual(['applied']);
    expect(await onHand(prisma, shop)).toBe(10);
  });

  it(
    'survives a sale applying a parked return while that terminal pushes another',
    { repeats: 15 },
    async () => {
      const sale = unsyncedSale(2);
      const first = returnEvent(shop, shop.t2, sale, { seq: 1, qtys: [[1, 1]] });
      const second = returnEvent(shop, shop.t2, sale, {
        seq: 2,
        qtys: [[1, 1]],
        returned: [[1, 1]],
      });
      await pushOk(app, shop.t2, [first]);

      await Promise.all([pushOk(app, shop.t1, [sale]), pushOk(app, shop.t2, [second])]);

      expect(await statuses()).toEqual(['applied', 'applied']);
      expect(await onHand(prisma, shop)).toBe(10);
    },
  );
});
