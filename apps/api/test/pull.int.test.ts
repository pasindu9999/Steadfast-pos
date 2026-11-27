/** Catalogue, staff and stock down to a terminal (ARCH §4.6). */
import { pullResponseSchema } from '@pos/core';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { startApp, type TestApp } from './helpers/app.js';
import { resetDb, testPrisma } from './helpers/db.js';
import { saleEvent } from './helpers/events.js';
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
  shop = await createShop(prisma, { stock: 3 });
});

const request = (cursor?: string, token = shop.t1.token) =>
  app.request(`/v1/sync/pull${cursor === undefined ? '' : `?cursor=${cursor}`}`, { token });

async function pull(cursor?: string, token?: string) {
  const response = await request(cursor, token);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { ...pullResponseSchema.parse(response.body), raw: response.body };
}

/** A cursor as if the earlier pull ran this long ago. */
const cursorAged = (seconds: number) =>
  Buffer.from(
    JSON.stringify({ v: 1, since: new Date(Date.now() - seconds * 1000).toISOString() }),
  ).toString('base64url');

/** Makes every row look old, as if nothing had changed for an hour. */
async function ageEverything() {
  for (const table of ['products', 'product_variants', 'inventory_levels']) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await prisma.$executeRawUnsafe(`UPDATE ${table} SET updated_at = now() - interval '1 hour'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
  }
}

describe('GET /v1/sync/pull: first pull', () => {
  it('sends the store, the whole catalogue, staff and stock', async () => {
    await prisma.category.create({ data: { id: uuidv7(), name: 'Shirts' } });
    await prisma.productVariant.update({
      where: { id: shop.variant.id },
      data: { costCents: 4321 },
    });

    const body = await pull();

    expect((await request()).headers.get('cache-control')).toBe('no-store');
    expect(body.store).toEqual({
      id: shop.store.id,
      code: 'S01',
      name: 'Test Store',
      timezone: 'Australia/Sydney',
      currency: 'AUD',
      taxRateBp: 1000,
      pricesIncludeTax: true,
      cashRoundingCents: 5,
    });
    expect(body.products).toMatchObject([{ id: shop.product.id, name: 'Linen Shirt' }]);
    expect(body.variants).toMatchObject([
      { id: shop.variant.id, sku: 'LIN-BLK-M', priceCents: 8900, isActive: true },
    ]);
    expect(body.staff).toEqual([
      { id: shop.staff.id, name: 'Casey', role: 'cashier', pinHash: 'x', isActive: true },
    ]);
    expect(body.inventory).toEqual([{ variantId: shop.variant.id, onHand: 3 }]);
    expect(body.lastAppliedSeq).toBe(0);
  });

  it('sends no cost price, secrets or other store data', async () => {
    const other = await prisma.store.create({
      data: { id: uuidv7(), code: 'S02', name: 'Second Store' },
    });
    const stranger = await prisma.staff.create({
      data: { id: uuidv7(), storeId: other.id, name: 'Robin', role: 'owner', pinHash: 'y' },
    });
    await prisma.inventoryLevel.create({
      data: { storeId: other.id, variantId: shop.variant.id, onHand: 999 },
    });
    await prisma.productVariant.update({
      where: { id: shop.variant.id },
      data: { costCents: 4321 },
    });

    const body = await pull();

    expect(body.staff.map((member) => member.id)).not.toContain(stranger.id);
    expect(body.inventory).toEqual([{ variantId: shop.variant.id, onHand: 3 }]);
    const raw = JSON.stringify(body.raw);
    for (const secret of ['costCents', '4321', 'deviceToken', 'TokenHash', 'enrolment']) {
      expect(raw).not.toContain(secret);
    }
  });

  it('includes archived items and former staff, so terminals can retire them', async () => {
    await prisma.product.update({ where: { id: shop.product.id }, data: { isActive: false } });
    await prisma.staff.update({ where: { id: shop.staff.id }, data: { isActive: false } });

    const body = await pull();

    expect(body.products).toMatchObject([{ isActive: false }]);
    expect(body.staff).toMatchObject([{ isActive: false }]);
  });

  it('sends negative stock', async () => {
    await pushOk(app, shop.t1, [saleEvent(shop, shop.t1, { seq: 1, lines: [{ qty: 4 }] })]);

    const body = await pull();

    expect(body.inventory).toEqual([{ variantId: shop.variant.id, onHand: -1 }]);
  });

  it('sends the last seq applied for this terminal only', async () => {
    await pushOk(app, shop.t1, [
      saleEvent(shop, shop.t1, { seq: 1 }),
      saleEvent(shop, shop.t1, { seq: 2 }),
    ]);

    expect((await pull()).lastAppliedSeq).toBe(2);
    expect((await pull(undefined, shop.t2.token)).lastAppliedSeq).toBe(0);
  });
});

describe('GET /v1/sync/pull: while a push is running', () => {
  it('reads stock and lastAppliedSeq from one snapshot', async () => {
    const events = Array.from({ length: 40 }, (_, index) =>
      saleEvent(shop, shop.t1, { seq: index + 1 }),
    );
    let pushing = true;
    const pushed = pushOk(app, shop.t1, events).finally(() => (pushing = false));
    const seen = [];
    while (pushing) seen.push(await pull());
    await pushed;

    expect(seen.length).toBeGreaterThan(1);
    for (const { inventory, lastAppliedSeq } of seen) {
      expect(inventory[0]!.onHand).toBe(3 - lastAppliedSeq);
    }
  });
});

describe('GET /v1/sync/pull: later pulls', () => {
  beforeEach(ageEverything);

  it('sends only store and staff when nothing changed', async () => {
    const { nextCursor } = await pull();

    const body = await pull(nextCursor);

    expect(body).toMatchObject({ products: [], variants: [], inventory: [] });
    expect(body.staff).toHaveLength(1);
    expect(body.store.code).toBe('S01');
  });

  it('sends what changed since the cursor', async () => {
    const other = await addVariant(prisma, shop, 'L', 2);
    await ageEverything();
    const { nextCursor } = await pull();
    await prisma.productVariant.update({
      where: { id: shop.variant.id },
      data: { priceCents: 7900 },
    });
    await pushOk(app, shop.t2, [
      saleEvent(shop, shop.t2, { seq: 1, lines: [{ variantId: other.id }] }),
    ]);

    const body = await pull(nextCursor);

    expect(body.products).toEqual([]);
    expect(body.variants).toMatchObject([{ id: shop.variant.id, priceCents: 7900 }]);
    expect(body.inventory).toEqual([{ variantId: other.id, onHand: 1 }]);
  });

  it('sends archived products and variants', async () => {
    const { nextCursor } = await pull();
    await prisma.product.update({ where: { id: shop.product.id }, data: { isActive: false } });
    await prisma.productVariant.update({
      where: { id: shop.variant.id },
      data: { isActive: false },
    });

    const body = await pull(nextCursor);

    expect(body.products).toMatchObject([{ isActive: false }]);
    expect(body.variants).toMatchObject([{ isActive: false }]);
  });

  it('re-reads the last minute, to catch writes that committed late', async () => {
    // An hour-old row is outside the window of a cursor 30 s old, and inside one 2 h old.
    expect((await pull(cursorAged(30))).variants).toEqual([]);
    expect((await pull(cursorAged(7200))).variants).toHaveLength(1);

    await prisma.$executeRawUnsafe(`ALTER TABLE products DISABLE TRIGGER USER`);
    await prisma.$executeRawUnsafe(
      `UPDATE products SET updated_at = now() - interval '45 seconds'`,
    );
    await prisma.$executeRawUnsafe(`ALTER TABLE products ENABLE TRIGGER USER`);

    expect((await pull(cursorAged(0))).products).toHaveLength(1);
  });

  it('gives a new cursor each time, taken from the database clock', async () => {
    const first = await pull();
    const second = await pull(first.nextCursor);

    const since = (cursor: string) =>
      (JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { since: string }).since;
    expect(Date.parse(since(second.nextCursor))).toBeGreaterThanOrEqual(
      Date.parse(since(first.nextCursor)),
    );
  });
});

describe('GET /v1/sync/pull: refusals', () => {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

  it.each([
    ['empty', ''],
    ['not base64 JSON', 'garbage'],
    ['another version', encoded({ v: 2, since: '2026-01-01T00:00:00.000Z' })],
    ['no time', encoded({ v: 1 })],
    ['a bad time', encoded({ v: 1, since: 'yesterday' })],
    ['an impossible year', encoded({ v: 1, since: '0000-01-01T00:00:00.000Z' })],
    ['not an object', encoded(null)],
    ['too long', 'a'.repeat(600)],
  ])('answers 400 for a cursor that is %s', async (_, cursor) => {
    const response = await request(cursor);

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
  });

  it('answers 401 without a valid token', async () => {
    const response = await request(undefined, 'x'.repeat(43));

    expect(response.status).toBe(401);
  });
});
