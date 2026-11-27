import { decodeReceiptQr, syncEventSchema } from '@pos/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosDatabase } from '../db/database';
import { toSyncEvent } from '../db/outbox-repo';
import { getSetting } from '../db/settings-repo';
import { getAvailable } from '../db/stock-repo';
import { TERMINAL_ID } from '../test/api-fixtures';
import { cart, cartLine, CASHIER_ID, LINEN_ID, TEE_ID } from '../test/checkout-fixtures';
import { STORE_ID } from '../test/fixtures';
import {
  makeSale,
  OTHER_RECEIPT_NO,
  OTHER_SALE_ID,
  otherTerminalQr,
} from '../test/return-fixtures';
import { CASHIER, MANAGER, MANAGER_ID, seedShop } from '../test/shop';
import { commitReturn, type ReturnDraft } from './commit-return';
import type { SaleRef } from './load-returnable';
import type { ReturnFailure } from './return-error';

const NOW = new Date('2026-11-27T02:30:00.000Z');

const fetch = vi.fn(() => Promise.reject(new Error('offline')));
beforeEach(() => vi.stubGlobal('fetch', fetch));
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const local = (saleId: string): SaleRef => ({ kind: 'local', saleId });
const fromCode = (text = otherTerminalQr()): SaleRef => ({
  kind: 'qr',
  qr: decodeReceiptQr(text)!,
});

const units = (qty: number, lineNo = 1, restock = true) => ({ lineNo, qty, restock });

/** One shirt back for cash, which needs no manager. */
const draft = (ref: SaleRef, fields: Partial<ReturnDraft> = {}): ReturnDraft => ({
  ref,
  selections: [units(1)],
  reason: 'Wrong size',
  method: 'cash',
  cardReference: null,
  staffId: CASHIER_ID,
  approval: null,
  ...fields,
});

const take = (database: PosDatabase, request: ReturnDraft) =>
  commitReturn(request, { database, now: () => NOW });

/** A terminal that has sold three shirts for $267.00. */
async function soldThree() {
  const database = await seedShop();
  const { sale } = await makeSale(database);
  return { database, sale, ref: local(sale.id) };
}

async function expectRefused(run: Promise<unknown>, code: ReturnFailure): Promise<void> {
  await expect(run).rejects.toMatchObject({ name: 'ReturnRefusedError', code });
}

const returnMovements = (database: PosDatabase) =>
  database.stockMovements.filter((movement) => movement.reason === 'return').toArray();

/** Nothing beyond what the sales before it wrote, and no number used. */
async function expectNoReturn(database: PosDatabase, sales = 1) {
  expect(await database.returns.count()).toBe(0);
  expect(await database.returnLines.count()).toBe(0);
  expect(await returnMovements(database)).toEqual([]);
  expect(await database.outbox.count()).toBe(sales);
  expect(await getSetting(database, 'returnSeq')).toBe(0);
  expect(await getSetting(database, 'outboxSeq')).toBe(sales);
}

describe('commitReturn: what is written', () => {
  it('stores the return, its line, refund, stock movement and event together', async () => {
    const { database, sale, ref } = await soldThree();

    const committed = await take(database, draft(ref));

    const id = expect.any(String) as string;
    const returnId = committed.return.id;
    expect(await database.returns.toArray()).toEqual([
      {
        id: returnId,
        returnNo: 'R-S01-T1-000001',
        originalSaleId: sale.id,
        originalReceiptNo: 'S01-T1-000001',
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
        staffId: CASHIER_ID,
        reason: 'Wrong size',
        refundTotalCents: 8900,
        roundingCents: 0,
        refunds: [{ refundId: id, method: 'cash', amountCents: 8900, cardReference: null }],
        occurredAt: NOW.toISOString(),
      },
    ]);
    expect(await database.returnLines.toArray()).toEqual([
      {
        id,
        returnId,
        saleLineNo: 1,
        variantId: LINEN_ID,
        qty: 1,
        refundCents: 8900,
        restock: true,
        nameSnapshot: 'Linen Shirt — Black / M',
      },
    ]);
    expect(committed.lines).toEqual(await database.returnLines.toArray());
    expect(await returnMovements(database)).toEqual([
      {
        id,
        variantId: LINEN_ID,
        delta: 1,
        reason: 'return',
        sourceType: 'return',
        sourceId: returnId,
        seq: 2,
        synced: 0,
        occurredAt: NOW.toISOString(),
      },
    ]);
    expect(committed).toMatchObject({ seq: 2 });
    expect(await getSetting(database, 'returnSeq')).toBe(1);
    expect(await getSetting(database, 'outboxSeq')).toBe(2);
    expect(await getSetting(database, 'receiptSeq')).toBe(1);
    // One on the shelf, three sold, one back.
    expect(await getAvailable(database, LINEN_ID)).toBe(-1);
  });

  it('queues the event the server expects, with nothing local in it', async () => {
    const { database, sale, ref } = await soldThree();

    const committed = await take(database, draft(ref));

    const row = (await database.outbox.get(2))!;
    expect(row).toMatchObject({ status: 'pending', eventId: committed.eventId });
    const event = toSyncEvent(row);
    expect(syncEventSchema.parse(event)).toEqual(event);
    expect(event).toEqual({
      eventId: committed.eventId,
      terminalId: TERMINAL_ID,
      seq: 2,
      type: 'RETURN_COMPLETED',
      schemaVersion: 1,
      occurredAt: NOW.toISOString(),
      payload: {
        returnId: committed.return.id,
        returnNo: 'R-S01-T1-000001',
        originalSaleId: sale.id,
        storeId: STORE_ID,
        staffId: CASHIER_ID,
        reason: 'Wrong size',
        refundTotalCents: 8900,
        roundingCents: 0,
        lines: [
          {
            returnLineId: committed.lines[0]!.id,
            saleLineNo: 1,
            variantId: LINEN_ID,
            qty: 1,
            refundCents: 8900,
            restock: true,
          },
        ],
        refunds: committed.return.refunds,
      },
    });
  });

  it('refunds what was paid after the cart discount', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(
      database,
      cart({ lines: [cartLine({ qty: 3 })], cartDiscount: { type: 'percent', value: 10 } }),
    );

    const { return: returned } = await take(database, draft(local(sale.id)));

    expect(returned.refundTotalCents).toBe(8010);
  });

  it('records the 5c rounding of a cash refund, and keeps a card refund exact', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(
      database,
      cart({ lines: [cartLine({ qty: 2, unitPriceCents: 1002 })] }),
    );

    const cash = await take(database, draft(local(sale.id)));
    const card = await take(
      database,
      draft(local(sale.id), { method: 'card', cardReference: ' 000123 ' }),
    );

    expect(cash.return).toMatchObject({ refundTotalCents: 1002, roundingCents: -2 });
    expect(cash.return.refunds[0]).toMatchObject({ method: 'cash', amountCents: 1000 });
    expect(card.return).toMatchObject({ refundTotalCents: 1002, roundingCents: 0 });
    expect(card.return.refunds[0]).toMatchObject({
      method: 'card',
      amountCents: 1002,
      cardReference: '000123',
    });
  });

  it('moves no stock for damaged goods', async () => {
    const { database, ref } = await soldThree();

    const { lines } = await take(database, draft(ref, { selections: [units(1, 1, false)] }));

    expect(lines).toMatchObject([{ qty: 1, restock: false, refundCents: 8900 }]);
    expect(await returnMovements(database)).toEqual([]);
    expect(await getAvailable(database, LINEN_ID)).toBe(-2);
    expect((await database.outbox.get(2))?.payload).toMatchObject({
      lines: [{ restock: false }],
    });
  });

  it('restocks only the lines that go back on the shelf', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(
      database,
      cart({
        lines: [
          cartLine({ unitPriceCents: 4000 }),
          cartLine({ variantId: TEE_ID, sku: 'TEE', name: 'Summer Tee', unitPriceCents: 3500 }),
        ],
      }),
    );

    await take(
      database,
      draft(local(sale.id), { selections: [units(1, 1, false), units(1, 2, true)] }),
    );

    expect(await returnMovements(database)).toMatchObject([{ variantId: TEE_ID, delta: 1 }]);
    expect(await database.returnLines.count()).toBe(2);
  });

  it('ignores a line left at zero', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(
      database,
      cart({ lines: [cartLine(), cartLine({ variantId: TEE_ID, sku: 'TEE', name: 'Tee' })] }),
    );

    const { lines } = await take(
      database,
      draft(local(sale.id), { selections: [units(0, 1), units(1, 2)] }),
    );

    expect(lines).toMatchObject([{ saleLineNo: 2 }]);
  });
});

describe('commitReturn: never more than was sold', () => {
  it('caps the second of two partial returns at what is left', async () => {
    const { database, ref } = await soldThree();
    const two = draft(ref, { selections: [units(2)], approval: MANAGER });

    const first = await take(database, two);
    await expectRefused(take(database, two), 'OVER_RETURN');
    const second = await take(database, draft(ref));
    await expectRefused(take(database, draft(ref)), 'OVER_RETURN');

    expect([first.return.returnNo, second.return.returnNo]).toEqual([
      'R-S01-T1-000001',
      'R-S01-T1-000002',
    ]);
    expect([first.seq, second.seq]).toEqual([2, 3]);
    expect(first.return.refundTotalCents + second.return.refundTotalCents).toBe(26_700);
    expect(await getSetting(database, 'returnSeq')).toBe(2);
    expect(await database.outbox.count()).toBe(3);
  });

  it('lets only one of two returns made at once take the last units', async () => {
    const { database, ref } = await soldThree();
    const two = draft(ref, { selections: [units(2)], approval: MANAGER });

    const results = await Promise.allSettled([take(database, two), take(database, two)]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await database.returns.count()).toBe(1);
  });

  it('numbers returns made at once without a gap or a repeat', async () => {
    const { database, ref } = await soldThree();

    const made = await Promise.all([1, 2, 3].map(() => take(database, draft(ref))));

    expect(made.map((one) => one.return.returnNo).sort()).toEqual([
      'R-S01-T1-000001',
      'R-S01-T1-000002',
      'R-S01-T1-000003',
    ]);
    expect(made.map((one) => one.seq).sort()).toEqual([2, 3, 4]);
  });
});

describe('commitReturn: a sale made on the other terminal', () => {
  it('returns it from the receipt code alone, with a manager', async () => {
    const database = await seedShop();

    const committed = await take(database, draft(fromCode(), { approval: MANAGER }));

    expect(committed.return).toMatchObject({
      returnNo: 'R-S01-T1-000001',
      originalSaleId: OTHER_SALE_ID,
      originalReceiptNo: OTHER_RECEIPT_NO,
      terminalId: TERMINAL_ID,
      staffId: CASHIER_ID,
      refundTotalCents: 8900,
    });
    expect(committed.lines).toMatchObject([
      { saleLineNo: 1, variantId: LINEN_ID, nameSnapshot: 'Linen Shirt — Black / M' },
    ]);
    expect(await returnMovements(database)).toMatchObject([{ delta: 1, seq: 1 }]);
    expect(await database.sales.count()).toBe(0);
    expect((await database.outbox.get(1))?.type).toBe('RETURN_COMPLETED');
  });

  it('needs a manager however small the refund', async () => {
    const database = await seedShop();

    await expectRefused(take(database, draft(fromCode())), 'APPROVAL_REQUIRED');

    await expectNoReturn(database, 0);
  });

  it('caps it at the quantity in the code, less what was returned here', async () => {
    const database = await seedShop();
    const one = draft(fromCode(), { approval: MANAGER });

    await expectRefused(take(database, { ...one, selections: [units(3)] }), 'OVER_RETURN');
    await take(database, one);
    await expectRefused(take(database, { ...one, selections: [units(2)] }), 'OVER_RETURN');
    await take(database, one);
    await expectRefused(take(database, one), 'OVER_RETURN');

    expect(await database.returns.count()).toBe(2);
  });
});

describe('commitReturn: manager approval', () => {
  const two = (ref: SaleRef, fields: Partial<ReturnDraft> = {}) =>
    draft(ref, { selections: [units(2)], ...fields });

  it('is needed above $100.00', async () => {
    const { database, ref } = await soldThree();

    await expectRefused(take(database, two(ref)), 'APPROVAL_REQUIRED');
    await expectNoReturn(database);

    await expect(take(database, two(ref, { approval: MANAGER }))).resolves.toBeDefined();
  });

  it('is not needed for exactly $100.00', async () => {
    const database = await seedShop();
    const { sale } = await makeSale(
      database,
      cart({ lines: [cartLine({ unitPriceCents: 10_000 })] }),
    );

    await expect(take(database, draft(local(sale.id)))).resolves.toBeDefined();
  });

  it.each([
    ['a cashier', CASHIER],
    ['a cashier claiming to be a manager', { ...CASHIER, role: 'manager' as const }],
    ['someone this terminal does not know', { ...MANAGER, id: OTHER_SALE_ID }],
  ])('is not given by %s', async (_, approval) => {
    const { database, ref } = await soldThree();

    await expectRefused(take(database, two(ref, { approval })), 'APPROVAL_REQUIRED');

    await expectNoReturn(database);
  });

  it('is not given by a manager who has since been retired', async () => {
    const { database, ref } = await soldThree();
    await database.staff.update(MANAGER_ID, { isActive: false });

    await expectRefused(take(database, two(ref, { approval: MANAGER })), 'APPROVAL_REQUIRED');
  });
});

describe('commitReturn: refusals', () => {
  it('refuses a voided sale', async () => {
    const { database, sale, ref } = await soldThree();
    await database.sales.update(sale.id, { status: 'voided' });

    await expectRefused(take(database, draft(ref)), 'SALE_VOIDED');
    // Also when its receipt code is what was read.
    const code = otherTerminalQr({ saleId: sale.id, receiptNo: sale.receiptNo });
    await expectRefused(take(database, draft(fromCode(code))), 'SALE_VOIDED');
    await expectNoReturn(database);
  });

  it('refuses a sale that is not stored', async () => {
    const { database } = await soldThree();

    await expectRefused(take(database, draft(local(OTHER_SALE_ID))), 'SALE_NOT_FOUND');
  });

  it.each([
    ['no line', []],
    ['only zeros', [units(0)]],
  ])('refuses a return of %s', async (_, selections) => {
    const { database, ref } = await soldThree();

    await expectRefused(take(database, draft(ref, { selections })), 'NOTHING_SELECTED');
    await expectNoReturn(database);
  });

  it.each([
    ['a negative quantity', [units(-1)]],
    ['part of a unit', [units(0.5)]],
    ['a line the sale does not have', [units(1, 2)]],
    ['a line chosen twice', [units(1), units(1)]],
  ])('refuses %s', async (_, selections) => {
    const { database, ref } = await soldThree();

    await expectRefused(take(database, draft(ref, { selections })), 'INVALID_RETURN');
    await expectNoReturn(database);
  });

  it('refuses a blank reason', async () => {
    const { database, ref } = await soldThree();

    await expectRefused(take(database, draft(ref, { reason: '  ' })), 'REASON_REQUIRED');
    await expectNoReturn(database);
  });

  it('shortens a long reason to what the server stores', async () => {
    const { database, ref } = await soldThree();

    const reason = `  torn\0 ${'x'.repeat(600)}`;
    const { return: returned } = await take(database, draft(ref, { reason }));

    expect(returned.reason).toHaveLength(500);
    expect(returned.reason?.startsWith('torn x')).toBe(true);
  });

  it('refuses a card number as the refund reference', async () => {
    const { database, ref } = await soldThree();

    await expectRefused(
      take(database, draft(ref, { method: 'card', cardReference: '4111 1111 1111 1111' })),
      'INVALID_RETURN',
    );
    await expectNoReturn(database);
  });

  it('keeps no card reference on a cash refund', async () => {
    const { database, ref } = await soldThree();

    const { return: returned } = await take(database, draft(ref, { cardReference: '000123' }));

    expect(returned.refunds[0]?.cardReference).toBeNull();
  });

  it('refuses to number a return on a terminal without a return counter', async () => {
    const { database, ref } = await soldThree();
    await database.settings.delete('returnSeq');

    await expectRefused(take(database, draft(ref)), 'NOT_READY');
    expect(await database.returns.count()).toBe(0);
  });
});

describe('commitReturn: all or nothing', () => {
  const fail = () => {
    throw new Error('power cut');
  };

  it.each(['returns', 'returnLines', 'stockMovements', 'outbox'] as const)(
    'leaves nothing behind if writing %s fails',
    async (table) => {
      const { database, ref } = await soldThree();
      database[table].hook('creating', fail);

      await expect(take(database, draft(ref))).rejects.toThrow();

      await expectNoReturn(database);
      database[table].hook('creating').unsubscribe(fail);
      const { seq, return: returned } = await take(database, draft(ref));
      expect(seq).toBe(2);
      expect(returned.returnNo).toBe('R-S01-T1-000001');
    },
  );

  it('leaves nothing behind if writing the counters fails', async () => {
    const { database, ref } = await soldThree();
    database.settings.hook('updating', fail);

    await expect(take(database, draft(ref))).rejects.toThrow();

    await expectNoReturn(database);
  });
});
