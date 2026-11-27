/** Online lookup of a receipt from another terminal (ARCH §7.4). */
import { receiptLookupResponseSchema } from '@pos/core';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { startApp, type TestApp } from './helpers/app.js';
import { resetDb, testPrisma } from './helpers/db.js';
import { returnEvent, saleEvent, voidEvent } from './helpers/events.js';
import { addVariant, createShop, type Shop } from './helpers/shop.js';
import { errorCode, pushOk } from './helpers/sync.js';

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

const lookUp = (receiptNo: string, token = shop.t2.token) =>
  app.request(`/v1/receipts/${encodeURIComponent(receiptNo)}`, { token });

async function found(receiptNo: string) {
  const response = await lookUp(receiptNo);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return receiptLookupResponseSchema.parse(response.body);
}

const without = (value: object, ...keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

async function soldOnT1() {
  const large = await addVariant(prisma, shop, 'L', 5);
  const sale = saleEvent(shop, shop.t1, {
    seq: 1,
    tender: 'card',
    lines: [{ qty: 3 }, { variantId: large.id }],
  });
  await pushOk(app, shop.t1, [sale]);
  return sale;
}

describe('GET /v1/receipts/:receiptNo', () => {
  it('finds a sale made on another terminal', async () => {
    const sale = await soldOnT1();

    const body = await found(sale.payload.receiptNo);

    const { lines, payments, ...header } = sale.payload;
    expect(body).toEqual({
      ...without(header, 'cartDiscount'),
      terminalId: shop.t1.id,
      status: 'completed',
      occurredAt: sale.occurredAt,
      voidedAt: null,
      lines: lines.map((line) => ({ ...without(line, 'lineId', 'discount'), returnedQty: 0 })),
      payments: payments.map((payment) => without(payment, 'paymentId')),
    });
  });

  it('adds up what earlier returns took from each line', async () => {
    const sale = await soldOnT1();
    await pushOk(app, shop.t2, [
      returnEvent(shop, shop.t2, sale, { seq: 1, qtys: [[1, 1]] }),
      returnEvent(shop, shop.t2, sale, { seq: 2, qtys: [[1, 1]], returned: [[1, 1]] }),
    ]);

    const body = await found(sale.payload.receiptNo);

    expect(body.lines.map((line) => [line.lineNo, line.returnedQty])).toEqual([
      [1, 2],
      [2, 0],
    ]);
  });

  it('shows that a sale was voided', async () => {
    const sale = await soldOnT1();
    const voided = voidEvent(shop.t1, sale, { seq: 2 });
    await pushOk(app, shop.t1, [voided]);

    expect(await found(sale.payload.receiptNo)).toMatchObject({
      status: 'voided',
      voidedAt: voided.occurredAt,
    });
  });

  it('accepts a number typed in lower case', async () => {
    const sale = await soldOnT1();

    expect((await found(sale.payload.receiptNo.toLowerCase())).saleId).toBe(sale.payload.saleId);
  });

  it('answers 404 for a number nobody has synced', async () => {
    const response = await lookUp('S01-T1-000999');

    expect(response.status).toBe(404);
    expect(errorCode(response.body)).toBe('NOT_FOUND');
  });

  it('answers 404 to a terminal of another store', async () => {
    const sale = await soldOnT1();
    const other = await prisma.store.create({
      data: { id: uuidv7(), code: 'S02', name: 'Second Store' },
    });
    await prisma.terminal.update({ where: { id: shop.t2.id }, data: { storeId: other.id } });

    const response = await lookUp(sale.payload.receiptNo);

    expect(response.status).toBe(404);
  });

  it.each(['nonsense', 'R-S01-T1-000001', 'x'.repeat(100)])('answers 400 for %s', async (value) => {
    const response = await lookUp(value);

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
  });

  it('answers 401 without a valid token', async () => {
    const response = await lookUp('S01-T1-000001', 'x'.repeat(43));

    expect(response.status).toBe(401);
  });
});
