import type { InventoryLevel } from '@pos/core';

import type { Prisma } from '../../generated/prisma/client.js';

/** Adds each delta to the cached stock level and returns the new levels. */
export async function addStock(
  tx: Prisma.TransactionClient,
  storeId: string,
  deltas: ReadonlyMap<string, number>,
): Promise<InventoryLevel[]> {
  if (deltas.size === 0) return [];
  const variantIds = [...deltas.keys()];
  const amounts = [...deltas.values()];

  // Raw SQL: `on_hand = on_hand + delta` in one atomic statement, so terminals syncing together
  // never lose an update. Rows lock in variant order, so two sales can't deadlock (ARCH §4.4, §5).
  return tx.$queryRaw<InventoryLevel[]>`
    INSERT INTO inventory_levels (store_id, variant_id, on_hand)
    SELECT ${storeId}::uuid, d.variant_id, d.delta
    FROM unnest(${variantIds}::uuid[], ${amounts}::int[]) AS d (variant_id, delta)
    ORDER BY d.variant_id
    ON CONFLICT (store_id, variant_id)
    DO UPDATE SET on_hand = inventory_levels.on_hand + EXCLUDED.on_hand
    RETURNING variant_id AS "variantId", on_hand AS "onHand"`;
}
