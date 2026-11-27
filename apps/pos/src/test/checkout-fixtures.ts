import type { CartLineDraft, SaleDraft } from '../checkout/sale-draft';
import type { PosDatabase } from '../db/database';
import { putSettings } from '../db/settings-repo';
import type { SettingValues } from '../db/types';
import { TERMINAL_ID } from './api-fixtures';
import { storeFixture } from './fixtures';
import { createTestDb } from './test-db';

export const LINEN_ID = '33333333-3333-4333-8333-333333333333';
export const TEE_ID = '44444444-4444-4444-8444-444444444444';
export const CASHIER_ID = '55555555-5555-4555-8555-555555555555';

/** A terminal that has enrolled and pulled once. */
export async function readyDb(
  settings: Partial<SettingValues> = {},
  database: PosDatabase = createTestDb(),
): Promise<PosDatabase> {
  await putSettings(database, {
    deviceToken: 'token',
    terminalId: TERMINAL_ID,
    terminalCode: 'T1',
    store: storeFixture,
    pullCursor: 'cursor-1',
    receiptSeq: 0,
    returnSeq: 0,
    outboxSeq: 0,
    ...settings,
  });
  return database;
}

export function cartLine(fields: Partial<CartLineDraft> = {}): CartLineDraft {
  return {
    variantId: LINEN_ID,
    sku: 'LIN-BLK-M',
    name: 'Linen Shirt — Black / M',
    qty: 1,
    unitPriceCents: 8900,
    ...fields,
  };
}

export function cart(fields: Partial<SaleDraft> = {}): SaleDraft {
  return { lines: [cartLine()], cartDiscount: null, staffId: CASHIER_ID, ...fields };
}
