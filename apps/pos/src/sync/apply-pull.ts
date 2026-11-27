import type { PullResponse } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { getSetting, putSettings } from '../db/settings-repo';

export interface PullSummary {
  /** `false` when the response was out of date and nothing was written. */
  applied: boolean;
  products: number;
  variants: number;
  /** Whether the catalogue index needs rebuilding. */
  catalogueChanged: boolean;
}

export interface ApplyPullOptions {
  /** The cursor the request was sent with; `undefined` for the first, full pull. */
  requestCursor: string | undefined;
  now?: Date;
}

/**
 * The server's stock level now includes everything up to `lastAppliedSeq`, so those events and
 * their local deltas stop counting (ARCH §4.6). This also covers an acknowledgement that was lost.
 */
async function markAcknowledged(database: PosDatabase, lastAppliedSeq: number): Promise<void> {
  await database.outbox
    .where('status')
    .equals('pending')
    .and((event) => event.seq <= lastAppliedSeq)
    .modify((event) => {
      event.status = 'synced';
    });
  await database.stockMovements
    .where('synced')
    .equals(0)
    .and((movement) => movement.seq <= lastAppliedSeq)
    .modify((movement) => {
      movement.synced = 1;
    });
}

/** Writes one pull response in a single transaction (ARCH §4.6). */
export function applyPull(
  database: PosDatabase,
  response: PullResponse,
  { requestCursor, now = new Date() }: ApplyPullOptions,
): Promise<PullSummary> {
  const { settings, products, variants, inventory, staff, outbox, stockMovements } = database;

  return database.transaction(
    'rw',
    [settings, products, variants, inventory, staff, outbox, stockMovements],
    async () => {
      // A response to an older request would move stock and the cursor backwards.
      if ((await getSetting(database, 'pullCursor')) !== requestCursor) {
        return { applied: false, products: 0, variants: 0, catalogueChanged: false };
      }
      if (requestCursor === undefined) {
        await products.clear();
        await variants.clear();
        await inventory.clear();
      }

      await products.bulkPut(response.products);
      // Delete first: two variants that swapped SKUs would break the unique index one at a time.
      await variants.bulkDelete(response.variants.map((variant) => variant.id));
      await variants.bulkAdd(response.variants);
      // All of the store's staff are sent every time.
      await staff.clear();
      await staff.bulkAdd(response.staff);
      // Only the server's level changes: local movements are never overwritten.
      await inventory.bulkPut(
        response.inventory.map(({ variantId, onHand }) => ({ variantId, serverOnHand: onHand })),
      );
      await markAcknowledged(database, response.lastAppliedSeq);
      await putSettings(database, {
        store: response.store,
        pullCursor: response.nextCursor,
        lastPulledAt: now.toISOString(),
      });

      return {
        applied: true,
        products: response.products.length,
        variants: response.variants.length,
        catalogueChanged: response.products.length + response.variants.length > 0,
      };
    },
  );
}
