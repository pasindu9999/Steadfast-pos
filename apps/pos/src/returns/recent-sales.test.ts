import { describe, expect, it } from 'vitest';

import { cart } from '../test/checkout-fixtures';
import { makeSale, recordReturnRows } from '../test/return-fixtures';
import { seedShop } from '../test/shop';
import { listRecentSales } from './recent-sales';

const at = (hour: number) => () => new Date(Date.UTC(2026, 10, 27, hour));

describe('listRecentSales', () => {
  it('is empty before the first sale', async () => {
    await expect(listRecentSales(await seedShop())).resolves.toEqual([]);
  });

  it('lists the newest first, with how each was paid and what has come back', async () => {
    const database = await seedShop();
    const first = await makeSale(database, undefined, undefined, at(1));
    const second = await makeSale(database, undefined, { method: 'card' }, at(2));
    const third = await makeSale(database, cart(), undefined, at(3));
    await recordReturnRows(database, first.sale.id, [[1, 3]]);
    await recordReturnRows(database, second.sale.id, [[1, 1]]);
    await database.sales.update(third.sale.id, { status: 'voided' });

    await expect(listRecentSales(database)).resolves.toEqual([
      {
        saleId: third.sale.id,
        receiptNo: 'S01-T1-000003',
        occurredAt: third.sale.occurredAt,
        totalCents: 8900,
        method: 'cash',
        voided: true,
        returned: 'none',
      },
      expect.objectContaining({ receiptNo: 'S01-T1-000002', method: 'card', returned: 'part' }),
      expect.objectContaining({ receiptNo: 'S01-T1-000001', voided: false, returned: 'all' }),
    ]);
  });

  it('stops at the limit', async () => {
    const database = await seedShop();
    for (let hour = 1; hour <= 3; hour += 1) {
      await makeSale(database, undefined, undefined, at(hour));
    }

    const recent = await listRecentSales(database, 2);

    expect(recent.map((sale) => sale.receiptNo)).toEqual(['S01-T1-000003', 'S01-T1-000002']);
  });
});
