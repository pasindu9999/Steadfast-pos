/** A terminal with sales waiting to be sent, and the network parts pointed at the fake API. */
import { commitSale } from '../checkout/commit-sale';
import type { PosDatabase } from '../db/database';
import type { SettingValues } from '../db/types';
import { createApiClient } from '../sync/api-client';
import type { SyncDeps } from '../sync/sync-deps';
import { cart, LINEN_ID, readyDb } from './checkout-fixtures';
import { API_URL } from './fake-sync-server';

export function syncDeps(database: PosDatabase, fetchFn?: typeof fetch): SyncDeps {
  return { database, createClient: (baseUrl) => createApiClient({ baseUrl, fetchFn }) };
}

/** Commits `count` one-shirt cash sales, one after another. */
export async function sell(database: PosDatabase, count = 1): Promise<void> {
  for (let sold = 0; sold < count; sold += 1) {
    await commitSale(cart(), { method: 'cash', tenderedCents: 10_000 }, { database });
  }
}

export async function terminalWithSales(
  count: number,
  { serverOnHand = 200, ...settings }: Partial<SettingValues> & { serverOnHand?: number } = {},
): Promise<PosDatabase> {
  const database = await readyDb({ apiUrl: API_URL, ...settings });
  await database.inventory.put({ variantId: LINEN_ID, serverOnHand });
  await sell(database, count);
  return database;
}

export const outboxStatuses = async (database: PosDatabase) =>
  (await database.outbox.toArray()).map((row) => row.status);

export const unsyncedSeqs = async (database: PosDatabase) =>
  (await database.stockMovements.where('synced').equals(0).toArray())
    .map((movement) => movement.seq)
    .sort((a, b) => a - b);

/** `1` to `count`. */
export const upTo = (count: number) => Array.from({ length: count }, (_, index) => index + 1);
