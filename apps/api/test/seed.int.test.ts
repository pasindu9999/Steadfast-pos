import { createHash } from 'node:crypto';
import { verifyPin } from '@pos/core';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedDatabase } from '../prisma/seed/seed.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { resetDb, testPrisma } from './helpers/db.js';

const CODES = { T1: 'DEMO-S01-T1', T2: 'DEMO-S01-T2' };

let prisma: PrismaClient;

beforeAll(() => {
  prisma = testPrisma();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const seed = (large = false) => seedDatabase(prisma, { large, enrolmentCodes: CODES });

const linenBlackMedium = () =>
  prisma.productVariant.findFirstOrThrow({
    where: { size: 'M', color: 'Black', product: { name: 'Linen Shirt' } },
    include: { inventoryLevels: true, stockMovements: true },
  });

/** Variants whose cached level differs from the sum of their ledger (ARCH §5.1). */
const unbalancedLevels = () => prisma.$queryRaw<unknown[]>`
  SELECT l.variant_id
  FROM inventory_levels l
  FULL JOIN (
    SELECT store_id, variant_id, sum(delta) AS total FROM stock_movements GROUP BY 1, 2
  ) m USING (store_id, variant_id)
  WHERE l.on_hand IS DISTINCT FROM m.total`;

async function snapshot() {
  const byId = { orderBy: { id: 'asc' } } as const;
  return {
    stores: await prisma.store.findMany(byId),
    terminals: await prisma.terminal.findMany(byId),
    staff: await prisma.staff.findMany(byId),
    categories: await prisma.category.findMany(byId),
    products: await prisma.product.findMany(byId),
    variants: await prisma.productVariant.findMany(byId),
    movements: await prisma.stockMovement.findMany(byId),
    inventory: await prisma.inventoryLevel.findMany({ orderBy: { variantId: 'asc' } }),
  };
}

function isEan13(barcode: string): boolean {
  if (!/^\d{13}$/.test(barcode)) return false;
  const sum = [...barcode].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
  return sum % 10 === 0;
}

describe('demo seed', () => {
  beforeAll(async () => {
    await resetDb(prisma);
    await seed();
  });

  it('creates the store, both terminals and the staff', async () => {
    const store = await prisma.store.findUniqueOrThrow({
      where: { code: 'S01' },
      include: {
        terminals: { orderBy: { code: 'asc' } },
        staff: { orderBy: { role: 'asc' } },
      },
    });

    expect(store).toMatchObject({ taxRateBp: 1000, pricesIncludeTax: true, cashRoundingCents: 5 });
    expect(store.terminals.map((t) => t.code)).toEqual(['T1', 'T2']);
    expect(store.staff.map((s) => s.role)).toEqual(['cashier', 'manager']);
    const [cashier, manager] = store.staff;
    await expect(verifyPin('1111', cashier!.pinHash)).resolves.toBe(true);
    await expect(verifyPin('9999', manager!.pinHash)).resolves.toBe(true);
    await expect(verifyPin('9999', cashier!.pinHash)).resolves.toBe(false);
  });

  it('stores reusable enrolment codes as hashes only', async () => {
    const terminals = await prisma.terminal.findMany({ orderBy: { code: 'asc' } });

    expect(terminals.map((t) => t.enrolmentCodeHash)).toEqual(
      [CODES.T1, CODES.T2].map((code) => createHash('sha256').update(code).digest('hex')),
    );
    for (const terminal of terminals) {
      expect(terminal.enrolmentCodeReusable).toBe(true);
      expect(terminal.deviceTokenHash).toBeNull();
    }
    expect(JSON.stringify(terminals, (_, v: unknown) => String(v))).not.toContain('DEMO-');
  });

  it('creates 4 categories, 15 products and 120 variants', async () => {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });

    expect(categories.map((c) => c.name)).toEqual(['Accessories', 'Dresses', 'Shirts', 'Trousers']);
    expect(await prisma.product.count()).toBe(15);
    expect(await prisma.productVariant.count()).toBe(120);
  });

  it('gives every garment XS to XL in three or four colours', async () => {
    const garments = await prisma.product.findMany({
      where: { category: { name: { not: 'Accessories' } } },
      include: { variants: { orderBy: { sizeSort: 'asc' } } },
    });

    expect(garments).toHaveLength(7);
    for (const garment of garments) {
      const colours = new Set(garment.variants.map((v) => v.color));
      expect(colours.size).toBeGreaterThanOrEqual(3);
      expect(colours.size).toBeLessThanOrEqual(4);
      expect([...new Set(garment.variants.map((v) => v.size))]).toEqual([
        'XS',
        'S',
        'M',
        'L',
        'XL',
      ]);
    }
  });

  it('uses valid, unique EAN-13 barcodes', async () => {
    const barcodes = (await prisma.productVariant.findMany()).map((v) => v.barcode!);

    expect(barcodes.filter((barcode) => !isEan13(barcode))).toEqual([]);
    expect(new Set(barcodes).size).toBe(120);
  });

  it('stocks exactly one Linen Shirt in Black / M for the conflict demo', async () => {
    const variant = await linenBlackMedium();

    expect(variant.inventoryLevels.map((l) => l.onHand)).toEqual([1]);
    expect(variant.stockMovements).toMatchObject([{ delta: 1, reason: 'receive' }]);
  });

  it('adds all stock through receive movements', async () => {
    expect(await prisma.inventoryLevel.count()).toBe(120);
    expect(await prisma.stockMovement.count({ where: { reason: 'receive' } })).toBe(120);
    expect(await unbalancedLevels()).toEqual([]);
  });
});

describe('re-running the seed', () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await seed();
  });

  it('changes nothing', async () => {
    const before = await snapshot();

    await seed();

    expect(await snapshot()).toEqual(before);
  });

  it('keeps sales stock, enrolment state and catalogue edits', async () => {
    const variant = await linenBlackMedium();
    const storeId = variant.inventoryLevels[0]!.storeId;
    await prisma.stockMovement.create({
      data: {
        id: uuidv7(),
        storeId,
        variantId: variant.id,
        delta: -1,
        reason: 'sale',
        occurredAt: new Date(),
      },
    });
    await prisma.inventoryLevel.update({
      where: { storeId_variantId: { storeId, variantId: variant.id } },
      data: { onHand: 0 },
    });
    await prisma.terminal.updateMany({
      where: { code: 'T1' },
      data: { deviceTokenHash: 'token-hash', lastAppliedSeq: 7, receiptSeq: 5 },
    });
    await prisma.productVariant.update({ where: { id: variant.id }, data: { priceCents: 100 } });
    const before = await snapshot();

    await seed();

    expect(await snapshot()).toEqual(before);
  });
});

describe('large seed', () => {
  it('builds 4,000 variants in under 30 s and is idempotent', async () => {
    await resetDb(prisma);
    const started = performance.now();

    await seed(true);

    expect(performance.now() - started).toBeLessThan(30_000);
    expect(await prisma.productVariant.count()).toBe(4000);
    expect(await prisma.inventoryLevel.count()).toBe(4000);
    const barcodes = (await prisma.productVariant.findMany()).map((v) => v.barcode!);
    expect(new Set(barcodes).size).toBe(4000);
    expect(barcodes.filter((barcode) => !isEan13(barcode))).toEqual([]);
    expect(await unbalancedLevels()).toEqual([]);
    expect((await linenBlackMedium()).inventoryLevels[0]?.onHand).toBe(1);

    await seed(true);

    expect(await prisma.productVariant.count()).toBe(4000);
    expect(await prisma.stockMovement.count()).toBe(4000);
    expect(await unbalancedLevels()).toEqual([]);
  });

  it('can be run on top of the demo seed', async () => {
    await resetDb(prisma);
    await seed();

    await seed(true);

    expect(await prisma.productVariant.count()).toBe(4000);
    expect(await unbalancedLevels()).toEqual([]);
  });
});
