/** A seeded terminal for screen tests: catalogue, stock and staff with fast PIN hashes. */
import { hashPin, MISC_SKU } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { CASHIER_ID, LINEN_ID, readyDb, TEE_ID } from './checkout-fixtures';
import { productFixture, staffFixture, variantFixture } from './fixtures';

export const MANAGER_ID = '66666666-6666-4666-8666-666666666666';
export const LEAVER_ID = '77777777-7777-4777-8777-777777777777';

export const MISC_ID = '88888888-8888-4888-8888-888888888888';

export const CASHIER_PIN = '1111';
export const MANAGER_PIN = '9999';

export const LINEN_BARCODE = '2000000000077';
export const TEE_BARCODE = '2000000000404';

export const CASHIER = { id: CASHIER_ID, name: 'Casey Cashier', role: 'cashier' } as const;
export const MANAGER = { id: MANAGER_ID, name: 'Morgan Manager', role: 'manager' } as const;

const hashes = new Map<string, Promise<string>>();

function quickHash(pin: string): Promise<string> {
  let hash = hashes.get(pin);
  if (!hash) {
    hash = hashPin(pin, { iterations: 1 });
    hashes.set(pin, hash);
  }
  return hash;
}

export async function seedShop(database?: PosDatabase): Promise<PosDatabase> {
  const ready = await readyDb({}, database);
  await ready.products.bulkAdd([
    productFixture({ id: 'p1', name: 'Linen Shirt' }),
    productFixture({ id: 'p2', name: 'Summer Tee' }),
    productFixture({ id: 'pm', name: 'Miscellaneous item', brand: null }),
  ]);
  await ready.variants.bulkAdd([
    variantFixture({
      id: LINEN_ID,
      productId: 'p1',
      sku: 'LIN-BLK-M',
      barcode: LINEN_BARCODE,
      priceCents: 8900,
    }),
    variantFixture({
      id: TEE_ID,
      productId: 'p2',
      sku: 'TEE-NVY-L',
      barcode: TEE_BARCODE,
      color: 'Navy',
      size: 'L',
      sizeSort: 4,
      priceCents: 3500,
    }),
    variantFixture({
      id: MISC_ID,
      productId: 'pm',
      sku: MISC_SKU,
      size: 'One Size',
      color: 'Assorted',
      priceCents: 0,
    }),
  ]);
  await ready.inventory.bulkAdd([
    { variantId: LINEN_ID, serverOnHand: 1 },
    { variantId: TEE_ID, serverOnHand: 5 },
  ]);
  await ready.staff.bulkAdd([
    staffFixture({ ...CASHIER, pinHash: await quickHash(CASHIER_PIN) }),
    staffFixture({ ...MANAGER, pinHash: await quickHash(MANAGER_PIN) }),
    staffFixture({ id: LEAVER_ID, name: 'Alex Leaver', isActive: false }),
  ]);
  return ready;
}
