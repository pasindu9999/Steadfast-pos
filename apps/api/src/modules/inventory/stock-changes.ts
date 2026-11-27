import { v7 as uuidv7 } from 'uuid';

import type { Prisma } from '../../generated/prisma/client.js';
import { addStock } from './add-stock.js';

export interface MovementSource {
  reason: 'sale' | 'void' | 'return';
  sourceType: 'sale' | 'return';
  sourceId: string;
  terminalId: string;
  staffId: string | null;
  occurredAt: Date;
}

export interface StockDelta {
  variantId: string;
  delta: number;
}

export class StockChanges {
  private readonly deltasByStore = new Map<string, Map<string, number>>();

  async record(
    tx: Prisma.TransactionClient,
    storeId: string,
    source: MovementSource,
    changes: readonly StockDelta[],
  ): Promise<void> {
    const deltas = this.deltasByStore.get(storeId) ?? new Map<string, number>();
    this.deltasByStore.set(storeId, deltas);
    for (const { variantId, delta } of changes) {
      deltas.set(variantId, (deltas.get(variantId) ?? 0) + delta);
    }
    await tx.stockMovement.createMany({
      data: changes.map((change) => ({ id: uuidv7(), storeId, ...source, ...change })),
    });
  }

  // Levels change once, at the end of the transaction: their rows are locked briefly and always in
  // store then variant order, so transactions can't deadlock on stock (ARCH §5.1).
  async apply(tx: Prisma.TransactionClient, triggerEventId: string): Promise<void> {
    const stores = [...this.deltasByStore].sort(([a], [b]) => a.localeCompare(b));
    for (const [storeId, deltas] of stores) {
      const levels = await addStock(tx, storeId, deltas);
      const short = levels.filter((level) => level.onHand < 0 && deltas.get(level.variantId)! < 0);
      // `skipDuplicates` is `ON CONFLICT DO NOTHING`: two transactions can't open two rows for one
      // variant, thanks to the `one_open_discrepancy` index (ARCH §5.2).
      await tx.stockDiscrepancy.createMany({
        data: short.map(({ variantId, onHand }) => ({
          id: uuidv7(),
          storeId,
          variantId,
          onHandAtDetection: onHand,
          triggerEventId,
        })),
        skipDuplicates: true,
      });
    }
  }
}
