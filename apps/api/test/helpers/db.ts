import { v7 as uuidv7 } from 'uuid';
import { inject } from 'vitest';

import { createPrismaClient } from '../../src/database/prisma-client.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

export function testPrisma(databaseUrl = inject('databaseUrl')): PrismaClient {
  return createPrismaClient(databaseUrl);
}

/** Every other table references one of these, so the cascade empties the database. */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE stores, categories, products CASCADE`;
}

export async function createCatalogue(prisma: PrismaClient) {
  const store = await prisma.store.create({
    data: { id: uuidv7(), code: 'S01', name: 'Test Store' },
  });
  const terminal = await prisma.terminal.create({
    data: { id: uuidv7(), storeId: store.id, code: 'T1' },
  });
  const staff = await prisma.staff.create({
    data: { id: uuidv7(), storeId: store.id, name: 'Casey', role: 'cashier', pinHash: 'x' },
  });
  const product = await prisma.product.create({ data: { id: uuidv7(), name: 'Linen Shirt' } });
  const variant = await prisma.productVariant.create({
    data: {
      id: uuidv7(),
      productId: product.id,
      sku: 'LIN-BLK-M',
      barcode: '2000000000015',
      size: 'M',
      color: 'Black',
      priceCents: 8900,
    },
  });
  return { store, terminal, staff, product, variant };
}
