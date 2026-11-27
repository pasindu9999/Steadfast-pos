import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

import { sha256Hex } from '../../src/common/sha256.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createCatalogue } from './db.js';

export interface TestTerminal {
  id: string;
  code: string;
  token: string;
}

/** A store with two enrolled terminals and `stock` Linen Shirts on the shelf. */
export async function createShop(prisma: PrismaClient, { stock = 1 } = {}) {
  const { store, terminal, staff, product, variant } = await createCatalogue(prisma);

  const enrol = async (id: string, code: string): Promise<TestTerminal> => {
    const token = randomBytes(32).toString('base64url');
    await prisma.terminal.update({ where: { id }, data: { deviceTokenHash: sha256Hex(token) } });
    return { id, code, token };
  };
  const second = await prisma.terminal.create({
    data: { id: uuidv7(), storeId: store.id, code: 'T2' },
  });

  const shop = {
    store,
    staff,
    product,
    variant,
    t1: await enrol(terminal.id, terminal.code),
    t2: await enrol(second.id, second.code),
  };
  if (stock !== 0) await receiveStock(prisma, store.id, variant.id, stock);
  return shop;
}

export type Shop = Awaited<ReturnType<typeof createShop>>;

export async function receiveStock(
  prisma: PrismaClient,
  storeId: string,
  variantId: string,
  qty: number,
): Promise<void> {
  await prisma.stockMovement.create({
    data: {
      id: uuidv7(),
      storeId,
      variantId,
      delta: qty,
      reason: 'receive',
      occurredAt: new Date(),
    },
  });
  await prisma.inventoryLevel.create({ data: { storeId, variantId, onHand: qty } });
}

export async function addVariant(prisma: PrismaClient, shop: Shop, size: string, stock = 0) {
  const variant = await prisma.productVariant.create({
    data: {
      id: uuidv7(),
      productId: shop.product.id,
      sku: `LIN-BLK-${size}`,
      size,
      color: 'Black',
      priceCents: 8900,
    },
  });
  if (stock !== 0) await receiveStock(prisma, shop.store.id, variant.id, stock);
  return variant;
}

export async function onHand(prisma: PrismaClient, shop: Shop, variantId = shop.variant.id) {
  const level = await prisma.inventoryLevel.findUnique({
    where: { storeId_variantId: { storeId: shop.store.id, variantId } },
  });
  return level?.onHand ?? 0;
}

/** What `on_hand` should be: the sum of the movements (ARCH §5.1). */
export async function ledgerSum(prisma: PrismaClient, shop: Shop, variantId = shop.variant.id) {
  const { _sum } = await prisma.stockMovement.aggregate({
    where: { storeId: shop.store.id, variantId },
    _sum: { delta: true },
  });
  return _sum.delta ?? 0;
}
