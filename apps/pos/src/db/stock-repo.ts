/**
 * Stock on the terminal is a projection (ARCH §4.6):
 * `available = serverOnHand + Σ unsynced local deltas`. It is never stored.
 */
import type { PosDatabase } from './database';
import type { StockMovementRow } from './types';

export function projectAvailable(
  serverOnHand: number,
  movements: readonly Pick<StockMovementRow, 'delta' | 'synced'>[],
): number {
  return movements.reduce(
    (total, movement) => (movement.synced === 0 ? total + movement.delta : total),
    serverOnHand,
  );
}

/** May be negative: a paid sale is never refused for stock (ARCH §5). */
export function getAvailableMany(
  database: PosDatabase,
  variantIds: readonly string[],
): Promise<Map<string, number>> {
  const { inventory, stockMovements } = database;
  const ids = [...new Set(variantIds)];

  // One transaction, so a pull can't land between reading the level and the movements.
  return database.transaction('r', inventory, stockMovements, async () => {
    const [levels, movements] = await Promise.all([
      inventory.bulkGet(ids),
      stockMovements.where('variantId').anyOf(ids).toArray(),
    ]);
    const byVariant = new Map<string, StockMovementRow[]>(ids.map((id) => [id, []]));
    for (const movement of movements) byVariant.get(movement.variantId)?.push(movement);

    return new Map(
      ids.map((id, index) => [
        id,
        projectAvailable(levels[index]?.serverOnHand ?? 0, byVariant.get(id) ?? []),
      ]),
    );
  });
}

export async function getAvailable(database: PosDatabase, variantId: string): Promise<number> {
  const available = await getAvailableMany(database, [variantId]);
  return available.get(variantId) ?? 0;
}
