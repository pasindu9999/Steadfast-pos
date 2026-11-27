import { describe, expect, it } from 'vitest';

import { createTestDb } from '../test/test-db';
import { DATABASE_NAME, db, PosDatabase } from './database';
import type { OutboxRow, SaleRow, StockMovementRow, VariantRow } from './types';

/** ARCH §6.3, primary key first. */
const SCHEMA = {
  settings: ['key'],
  products: ['id', 'name', 'updatedAt'],
  variants: ['id', '&sku', 'barcode', 'productId', 'updatedAt'],
  inventory: ['variantId'],
  staff: ['id'],
  sales: ['id', '&receiptNo', 'occurredAt'],
  saleLines: ['id', 'saleId', 'variantId'],
  payments: ['id', 'saleId'],
  returns: ['id', '&returnNo', 'originalSaleId', 'occurredAt'],
  returnLines: ['id', 'returnId', 'saleLineId'],
  stockMovements: ['id', 'variantId', 'synced'],
  outbox: ['seq', '&eventId', 'status'],
};

const variant = (id: string, sku: string): VariantRow => ({
  id,
  productId: 'p1',
  sku,
  barcode: null,
  size: 'M',
  sizeSort: 3,
  color: 'Black',
  priceCents: 1000,
  isActive: true,
  updatedAt: '2026-11-01T00:00:00.000Z',
});

// Only the indexed fields matter to these constraint tests.
const sale = (id: string, receiptNo: string) => ({ id, receiptNo }) as SaleRow;
const event = (seq: number, eventId: string) => ({ seq, eventId, status: 'pending' }) as OutboxRow;
const movement = (id: string, synced: 0 | 1) =>
  ({ id, variantId: 'v1', delta: -1, seq: 1, synced }) as StockMovementRow;

describe('PosDatabase', () => {
  it('is version 1 with the tables, keys and indexes of ARCH §6.3', async () => {
    const database = createTestDb();
    await database.open();

    const actual = Object.fromEntries(
      database.tables.map(({ name, schema }) => [
        name,
        [schema.primKey.src, ...schema.indexes.map((index) => index.src)],
      ]),
    );

    expect(database.verno).toBe(1);
    expect(actual).toEqual(SCHEMA);
  });

  it('exposes every table as a typed property', () => {
    const database = createTestDb();

    for (const name of Object.keys(SCHEMA) as (keyof typeof SCHEMA)[]) {
      expect(database[name]?.name).toBe(name);
    }
  });

  it('shares one database for the app', () => {
    expect(db).toBeInstanceOf(PosDatabase);
    expect(db.name).toBe(DATABASE_NAME);
  });

  it('refuses a second variant with the same SKU', async () => {
    const { variants } = createTestDb();
    await variants.add(variant('v1', 'TEE-NVY-M'));

    await expect(variants.add(variant('v2', 'TEE-NVY-M'))).rejects.toThrow(/constraint/i);
  });

  it('refuses a duplicate receipt number, return number or event id', async () => {
    const database = createTestDb();
    await database.sales.add(sale('s1', 'S01-T1-000001'));
    await database.returns.add({ id: 'r1', returnNo: 'R-S01-T1-000001' } as never);
    await database.outbox.add(event(1, 'e1'));

    await expect(database.sales.add(sale('s2', 'S01-T1-000001'))).rejects.toThrow(/constraint/i);
    await expect(
      database.returns.add({ id: 'r2', returnNo: 'R-S01-T1-000001' } as never),
    ).rejects.toThrow(/constraint/i);
    await expect(database.outbox.add(event(2, 'e1'))).rejects.toThrow(/constraint/i);
  });

  it('never assigns an outbox seq itself', async () => {
    const database = createTestDb();
    await database.open();

    expect(database.outbox.schema.primKey.auto).toBeFalsy();
    await expect(
      database.outbox.add({ eventId: 'e1', status: 'pending' } as OutboxRow),
    ).rejects.toThrow();
    await database.outbox.add(event(1, 'e1'));
    await expect(database.outbox.add(event(1, 'e2'))).rejects.toThrow(/constraint/i);
  });

  it('finds unsynced movements by the 0 or 1 flag', async () => {
    const { stockMovements } = createTestDb();
    await stockMovements.bulkAdd([movement('m1', 0), movement('m2', 1), movement('m3', 0)]);

    const unsynced = await stockMovements.where('synced').equals(0).primaryKeys();

    expect(unsynced).toEqual(['m1', 'm3']);
  });

  it('keeps its rows after being closed and reopened', async () => {
    const first = createTestDb();
    await first.outbox.add(event(1, 'e1'));
    first.close();

    const second = new PosDatabase(first.name);

    expect(await second.outbox.get(1)).toMatchObject({ eventId: 'e1' });
  });
});
