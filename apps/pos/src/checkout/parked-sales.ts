/**
 * Sales set aside to be finished later. They live in `settings`, so they survive a reload, and
 * they are not sales yet: no receipt number, stock movement or outbox event (ARCH §6.3).
 */
import type { PosDatabase } from '../db/database';
import { getSetting, putSettings } from '../db/settings-repo';
import type { ParkedSale } from '../db/types';
import type { Cart } from './cart';

/** Oldest first. */
export async function listParkedSales(database: PosDatabase): Promise<ParkedSale[]> {
  return (await getSetting(database, 'parkedSales')) ?? [];
}

export function parkSale(
  database: PosDatabase,
  { lines, cartDiscount, approvals, scanHistory }: Cart,
  details: Omit<ParkedSale, 'cart'>,
): Promise<void> {
  return database.transaction('rw', database.settings, async () => {
    const cart = { lines, cartDiscount, approvals, scanHistory };
    const parked = await listParkedSales(database);
    await putSettings(database, { parkedSales: [...parked, { ...details, cart }] });
  });
}

/** Removes a parked sale and returns it, so only one caller ever gets it. */
export function takeParkedSale(database: PosDatabase, id: string): Promise<ParkedSale | undefined> {
  return database.transaction('rw', database.settings, async () => {
    const parked = await listParkedSales(database);
    const found = parked.find((sale) => sale.id === id);
    if (found) {
      await putSettings(database, { parkedSales: parked.filter((sale) => sale !== found) });
    }
    return found;
  });
}
