import type { PullProduct, PullResponse, PullStaff, PullStore, PullVariant } from '@pos/core';

export const STORE_ID = '11111111-1111-4111-8111-111111111111';

export const storeFixture: PullStore = {
  id: STORE_ID,
  code: 'S01',
  name: 'Demo Boutique',
  timezone: 'Australia/Sydney',
  currency: 'AUD',
  taxRateBp: 1000,
  pricesIncludeTax: true,
  cashRoundingCents: 5,
};

const UPDATED_AT = '2026-11-01T00:00:00.000Z';

export function productFixture(fields: Partial<PullProduct> & { id: string }): PullProduct {
  return {
    name: 'Linen Shirt',
    brand: 'Harbour & Co',
    categoryId: null,
    description: null,
    isActive: true,
    updatedAt: UPDATED_AT,
    ...fields,
  };
}

export function variantFixture(fields: Partial<PullVariant> & { id: string }): PullVariant {
  return {
    productId: 'p1',
    sku: `SKU-${fields.id}`,
    barcode: null,
    size: 'M',
    sizeSort: 3,
    color: 'Black',
    priceCents: 8900,
    isActive: true,
    updatedAt: UPDATED_AT,
    ...fields,
  };
}

export function staffFixture(fields: Partial<PullStaff> & { id: string }): PullStaff {
  return {
    name: 'Casey Cashier',
    role: 'cashier',
    pinHash: 'pbkdf2-sha256$1$00$' + '0'.repeat(64),
    isActive: true,
    ...fields,
  };
}

export function pullFixture(fields: Partial<PullResponse> = {}): PullResponse {
  return {
    store: storeFixture,
    products: [],
    variants: [],
    staff: [],
    inventory: [],
    nextCursor: 'cursor-1',
    lastAppliedSeq: 0,
    ...fields,
  };
}
