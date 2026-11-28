import type { PosDatabase } from '../db/database';
import { getSetting } from '../db/settings-repo';
import type { Printer } from './print-service';

/**
 * After a sale: asks for its receipt to be printed, if this terminal prints automatically. The sale
 * is already saved, so nothing here may fail it.
 */
export async function requestAutoPrint(
  database: PosDatabase,
  printer: Pick<Printer, 'request'>,
  saleId: string,
): Promise<void> {
  try {
    if (await getSetting(database, 'autoPrint')) printer.request(saleId);
  } catch (error) {
    console.warn('auto-print skipped', (error as Error | null)?.name);
  }
}
