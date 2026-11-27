import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createCatalogue, resetDb, testPrisma } from './helpers/db.js';
import { runPrisma } from './helpers/prisma-cli.js';

let prisma: PrismaClient;

beforeAll(() => {
  prisma = testPrisma();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** The first SQL block after the §6.2 heading. */
function referenceDdl(): string {
  const architecture = readFileSync(new URL('../../../ARCHITECTURE.md', import.meta.url), 'utf8');
  const section = architecture.slice(architecture.indexOf('### 6.2 '));
  const block = /```sql\r?\n([\s\S]*?)```/.exec(section)?.[1];
  if (!block) throw new Error('no SQL block found under ARCHITECTURE.md §6.2');
  return block;
}

function normaliseDefault(value: string | null): string | null {
  if (value === null) return null;
  return value.replace('CURRENT_TIMESTAMP', 'now()').replace('ARRAY[]::text[]', "'{}'::text[]");
}

async function describeSchema(client: PrismaClient) {
  const columns = await client.$queryRaw<
    { column: string; type: string; nullable: string; default: string | null }[]
  >`
    SELECT table_name || '.' || column_name AS "column",
           udt_name || coalesce('(' || character_maximum_length || ')', '') AS "type",
           is_nullable AS "nullable",
           column_default AS "default"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
    ORDER BY 1`;
  const constraints = await client.$queryRaw<{ definition: string }[]>`
    SELECT conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS "definition"
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND contype IN ('p', 'f', 'c')
      AND conrelid::regclass::text <> '_prisma_migrations'
    ORDER BY 1`;
  const indexes = await client.$queryRaw<{ definition: string }[]>`
    SELECT indexdef AS "definition"
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY indexname`;
  const triggers = await client.$queryRaw<{ definition: string }[]>`
    SELECT pg_get_triggerdef(oid) AS "definition"
    FROM pg_trigger
    WHERE NOT tgisinternal
    ORDER BY tgname`;
  return {
    columns: columns.map((c) => ({ ...c, default: normaliseDefault(c.default) })),
    constraints: constraints.map((c) => c.definition),
    indexes: indexes.map((i) => i.definition),
    triggers: triggers.map((t) => t.definition),
  };
}

describe('migrations', () => {
  it('apply to a clean database', async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT migration_name AS "name" FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1`;

    expect(rows.map((r) => r.name.replace(/^\d+_/, ''))).toEqual([
      'init',
      'constraints_and_partial_indexes',
    ]);
  });

  it('leave no drift against the Prisma schema', () => {
    const diff = runPrisma(
      [
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--script',
        '--exit-code',
      ],
      inject('databaseUrl'),
    );

    expect(diff.stdout + diff.stderr).not.toMatch(/\b(CREATE|ALTER|DROP)\b/);
    expect(diff.status).toBe(0);
  });

  it('match the reference DDL in ARCHITECTURE.md §6.2', async () => {
    await prisma.$executeRaw`DROP DATABASE IF EXISTS ddl_reference`;
    await prisma.$executeRaw`CREATE DATABASE ddl_reference`;
    const referenceUrl = new URL(inject('databaseUrl'));
    referenceUrl.pathname = '/ddl_reference';

    const directory = mkdtempSync(path.join(tmpdir(), 'pos-ddl-'));
    const file = path.join(directory, 'reference.sql');
    writeFileSync(file, referenceDdl());
    const applied = runPrisma(['db', 'execute', '--file', file], referenceUrl.href);
    rmSync(directory, { recursive: true, force: true });
    expect(applied.status, applied.stderr).toBe(0);

    const reference = testPrisma(referenceUrl.href);
    try {
      const expected = await describeSchema(reference);
      const actual = await describeSchema(prisma);

      expect(expected.columns.length).toBeGreaterThan(100);
      expect(actual.columns).toEqual(expected.columns);
      expect(actual.constraints).toEqual(expected.constraints);
      expect(actual.indexes).toEqual(expected.indexes);
      expect(actual.triggers).toEqual(expected.triggers);
    } finally {
      await reference.$disconnect();
    }
  });
});

describe('database rules', () => {
  let fixtures: Awaited<ReturnType<typeof createCatalogue>>;

  beforeEach(async () => {
    await resetDb(prisma);
    fixtures = await createCatalogue(prisma);
  });

  const openDiscrepancy = () =>
    prisma.stockDiscrepancy.create({
      data: {
        id: uuidv7(),
        storeId: fixtures.store.id,
        variantId: fixtures.variant.id,
        onHandAtDetection: -1,
      },
    });

  const sale = (overrides: { receiptNo?: string; status?: string } = {}) =>
    prisma.sale.create({
      data: {
        id: uuidv7(),
        receiptNo: 'S01-T1-000001',
        storeId: fixtures.store.id,
        terminalId: fixtures.terminal.id,
        status: 'completed',
        subtotalCents: 8900,
        taxCents: 809,
        totalCents: 8900,
        occurredAt: new Date(),
        ...overrides,
      },
    });

  it('allow negative stock (ARCH §5)', async () => {
    const level = await prisma.inventoryLevel.create({
      data: { storeId: fixtures.store.id, variantId: fixtures.variant.id, onHand: -3 },
    });

    expect(level.onHand).toBe(-3);
  });

  it('keep one open discrepancy per store and variant', async () => {
    const first = await openDiscrepancy();
    await expect(openDiscrepancy()).rejects.toThrow(/unique/i);

    await prisma.stockDiscrepancy.update({
      where: { id: first.id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });

    await expect(openDiscrepancy()).resolves.toMatchObject({ status: 'open' });
    expect(await prisma.stockDiscrepancy.count()).toBe(2);
  });

  it.each([
    ['staff_role_check', () => prisma.$executeRaw`UPDATE staff SET role = 'admin'`],
    [
      'product_variants_price_cents_check',
      () => prisma.$executeRaw`UPDATE product_variants SET price_cents = -1`,
    ],
    [
      'stock_movements_delta_check',
      () => prisma.$executeRaw`
        INSERT INTO stock_movements (id, store_id, variant_id, delta, reason, occurred_at)
        SELECT gen_random_uuid(), s.id, v.id, 0, 'sale', now() FROM stores s, product_variants v`,
    ],
    [
      'stock_movements_reason_check',
      () => prisma.$executeRaw`
        INSERT INTO stock_movements (id, store_id, variant_id, delta, reason, occurred_at)
        SELECT gen_random_uuid(), s.id, v.id, 1, 'gift', now() FROM stores s, product_variants v`,
    ],
    [
      'stock_discrepancies_status_check',
      () => prisma.$executeRaw`
        INSERT INTO stock_discrepancies (id, store_id, variant_id, on_hand_at_detection, status)
        SELECT gen_random_uuid(), s.id, v.id, -1, 'ignored' FROM stores s, product_variants v`,
    ],
    [
      'sync_inbox_status_check',
      () => prisma.$executeRaw`
        INSERT INTO sync_inbox (event_id, terminal_id, seq, type, status, payload, occurred_at)
        SELECT gen_random_uuid(), id, 1, 'SALE_COMPLETED', 'pending', '{}', now() FROM terminals`,
    ],
    ['sales_status_check', () => sale({ status: 'draft' })],
  ])('enforce %s', async (constraint, write) => {
    await expect(write()).rejects.toThrow(new RegExp(constraint));
  });

  it.each([
    ['sale_lines_qty_check', 0, 'cash', 1, 'cash'],
    ['payments_method_check', 1, 'cheque', 1, 'cash'],
    ['return_lines_qty_check', 1, 'cash', 0, 'cash'],
    ['refunds_method_check', 1, 'cash', 1, 'voucher'],
  ])('enforce %s', async (constraint, saleQty, paymentMethod, returnQty, refundMethod) => {
    const write = async () => {
      const { id: saleId } = await sale();
      const line = await prisma.saleLine.create({
        data: {
          id: uuidv7(),
          saleId,
          lineNo: 1,
          variantId: fixtures.variant.id,
          skuSnapshot: 'LIN-BLK-M',
          nameSnapshot: 'Linen Shirt',
          qty: saleQty,
          unitPriceCents: 8900,
          taxCents: 809,
          lineTotalCents: 8900,
        },
      });
      await prisma.payment.create({
        data: { id: uuidv7(), saleId, method: paymentMethod, amountCents: 8900 },
      });
      const saleReturn = await prisma.saleReturn.create({
        data: {
          id: uuidv7(),
          returnNo: 'R-S01-T1-000001',
          originalSaleId: saleId,
          storeId: fixtures.store.id,
          terminalId: fixtures.terminal.id,
          refundTotalCents: 8900,
          occurredAt: new Date(),
        },
      });
      await prisma.returnLine.create({
        data: {
          id: uuidv7(),
          returnId: saleReturn.id,
          saleLineId: line.id,
          qty: returnQty,
          refundCents: 8900,
        },
      });
      await prisma.refund.create({
        data: { id: uuidv7(), returnId: saleReturn.id, method: refundMethod, amountCents: 8900 },
      });
    };

    await expect(write()).rejects.toThrow(new RegExp(constraint));
  });

  it('refuse a duplicate receipt number (ARCH §4.5)', async () => {
    await sale();

    await expect(sale()).rejects.toThrow(/unique/i);
  });

  it('refuse a duplicate SKU or barcode', async () => {
    const copy = (sku: string, barcode: string) =>
      prisma.productVariant.create({
        data: {
          id: uuidv7(),
          productId: fixtures.product.id,
          sku,
          barcode,
          size: 'L',
          color: 'Black',
          priceCents: 8900,
        },
      });

    await expect(copy('LIN-BLK-M', '2000000000022')).rejects.toThrow(/unique/i);
    await expect(copy('LIN-BLK-L', '2000000000015')).rejects.toThrow(/unique/i);
  });

  it('refuse two inbox rows with the same terminal and seq', async () => {
    const insert = () =>
      prisma.syncInbox.create({
        data: {
          eventId: uuidv7(),
          terminalId: fixtures.terminal.id,
          seq: 1,
          type: 'SALE_COMPLETED',
          status: 'applied',
          payload: {},
          occurredAt: new Date(),
        },
      });
    await insert();

    await expect(insert()).rejects.toThrow(/unique/i);
  });

  it.each([
    ['products', () => prisma.$executeRaw`UPDATE products SET updated_at = '2000-01-01'`],
    [
      'product_variants',
      () => prisma.$executeRaw`UPDATE product_variants SET updated_at = '2000-01-01'`,
    ],
    [
      'inventory_levels',
      () => prisma.$executeRaw`
        INSERT INTO inventory_levels (store_id, variant_id, updated_at)
        SELECT s.id, v.id, '2000-01-01' FROM stores s, product_variants v`,
    ],
  ])('stamp updated_at on %s with the database clock', async (table, write) => {
    await write();

    const [row] = await prisma.$queryRawUnsafe<{ fresh: boolean }[]>(
      `SELECT bool_and(updated_at > now() - interval '1 minute') AS fresh FROM ${table}`,
    );
    expect(row?.fresh).toBe(true);
  });
});
