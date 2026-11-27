import { hashPin, MISC_SKU } from '@pos/core';
import { v5 as uuidv5 } from 'uuid';

import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { addStock } from '../../src/modules/inventory/add-stock.js';
import { hashEnrolmentCode } from '../../src/modules/terminals/enrolment-code.js';
import { buildCatalogue, CATEGORIES, DEMO_PRODUCTS, largeCatalogueProducts } from './catalogue.js';

const NAMESPACE = '7d0c1c0e-5b1a-4f53-9a55-2f0b6f4a9e11';
const BATCH = 1000;

/** The same name always gives the same ID, which is what makes re-running safe. */
const seedId = (name: string) => uuidv5(name, NAMESPACE);

export interface SeedOptions {
  large: boolean;
  enrolmentCodes: { T1: string; T2: string };
}

function batches<T>(items: readonly T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / BATCH) }, (_, index) =>
    items.slice(index * BATCH, (index + 1) * BATCH),
  );
}

async function seedOrganisation(prisma: PrismaClient, codes: SeedOptions['enrolmentCodes']) {
  const storeId = seedId('store:S01');
  await prisma.store.createMany({
    data: [{ id: storeId, code: 'S01', name: 'Demo Boutique' }],
    skipDuplicates: true,
  });
  await prisma.terminal.createMany({
    data: (['T1', 'T2'] as const).map((code) => ({
      id: seedId(`terminal:S01:${code}`),
      storeId,
      code,
      enrolmentCodeHash: hashEnrolmentCode(codes[code]),
      // Demo terminals only: the codes in the README keep working.
      enrolmentCodeReusable: true,
    })),
    skipDuplicates: true,
  });

  const staff = [
    { name: 'Casey Cashier', role: 'cashier', pin: '1111' },
    { name: 'Morgan Manager', role: 'manager', pin: '9999' },
  ];
  await prisma.staff.createMany({
    data: await Promise.all(
      staff.map(async ({ name, role, pin }) => ({
        id: seedId(`staff:S01:${role}`),
        storeId,
        name,
        role,
        pinHash: await hashPin(pin),
      })),
    ),
    skipDuplicates: true,
  });
  return storeId;
}

/**
 * The placeholder a terminal sells an unknown item under, at a typed price (ARCH §13). It has no
 * barcode and no opening stock.
 */
async function seedMiscItem(prisma: PrismaClient) {
  const productId = seedId(`product:${MISC_SKU}`);
  await prisma.product.createMany({
    data: [{ id: productId, name: 'Miscellaneous item' }],
    skipDuplicates: true,
  });
  await prisma.productVariant.createMany({
    data: [
      {
        id: seedId(`variant:${MISC_SKU}`),
        productId,
        sku: MISC_SKU,
        size: 'One Size',
        color: 'Assorted',
        priceCents: 0,
      },
    ],
    skipDuplicates: true,
  });
}

/** Inserts what is missing and never updates a row that exists. */
export async function seedDatabase(prisma: PrismaClient, options: SeedOptions) {
  const storeId = await seedOrganisation(prisma, options.enrolmentCodes);

  await prisma.category.createMany({
    data: CATEGORIES.map((name) => ({ id: seedId(`category:${name}`), name })),
    skipDuplicates: true,
  });

  const catalogue = [
    ...buildCatalogue(DEMO_PRODUCTS, '200'),
    ...(options.large ? buildCatalogue(largeCatalogueProducts(), '210') : []),
  ];
  await prisma.product.createMany({
    data: catalogue.map(({ product }) => ({
      id: seedId(`product:${product.code}`),
      name: product.name,
      brand: 'Harbour & Co',
      categoryId: seedId(`category:${product.category}`),
    })),
    skipDuplicates: true,
  });

  const variants = catalogue.flatMap(({ product, variants }) =>
    variants.map(({ openingStock, ...variant }) => ({
      openingStock,
      row: {
        ...variant,
        id: seedId(`variant:${variant.sku}`),
        productId: seedId(`product:${product.code}`),
      },
    })),
  );
  for (const batch of batches(variants)) {
    await prisma.productVariant.createMany({
      data: batch.map(({ row }) => row),
      skipDuplicates: true,
    });
    // Stock exists only as ledger movements (ARCH §5.1), and a level moves only with a new one.
    await prisma.$transaction(
      async (tx) => {
        const received = await tx.stockMovement.createManyAndReturn({
          data: batch.map(({ row, openingStock }) => ({
            id: seedId(`receive:${row.sku}`),
            storeId,
            variantId: row.id,
            delta: openingStock,
            reason: 'receive',
            sourceType: 'seed',
            occurredAt: new Date(),
          })),
          skipDuplicates: true,
          select: { variantId: true, delta: true },
        });
        await addStock(tx, storeId, new Map(received.map((m) => [m.variantId, m.delta])));
      },
      { timeout: 30_000 },
    );
  }

  await seedMiscItem(prisma);

  return { products: catalogue.length, variants: variants.length };
}
