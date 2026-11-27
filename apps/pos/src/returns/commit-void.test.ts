import { syncEventSchema } from '@pos/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PosDatabase } from '../db/database';
import { toSyncEvent } from '../db/outbox-repo';
import { getSetting } from '../db/settings-repo';
import { getAvailable } from '../db/stock-repo';
import { TERMINAL_ID } from '../test/api-fixtures';
import { cart, cartLine, LINEN_ID, TEE_ID } from '../test/checkout-fixtures';
import { makeSale, OTHER_SALE_ID } from '../test/return-fixtures';
import { CASHIER, MANAGER, MANAGER_ID, seedShop } from '../test/shop';
import { commitReturn } from './commit-return';
import { commitVoid, loadVoidState, type VoidDraft } from './commit-void';
import type { VoidFailure } from './void-error';

/** 12:00 on 27 November in Sydney. */
const SOLD = '2026-11-27T01:00:00.000Z';
const LATER = '2026-11-27T05:00:00.000Z';

const fetch = vi.fn(() => Promise.reject(new Error('offline')));
beforeEach(() => vi.stubGlobal('fetch', fetch));
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const twoLines = cart({
  lines: [
    cartLine({ qty: 2 }),
    cartLine({ variantId: TEE_ID, sku: 'TEE', name: 'Summer Tee', unitPriceCents: 3500 }),
  ],
});

async function soldOne(soldAt = SOLD) {
  const database = await seedShop();
  const { sale } = await makeSale(database, twoLines, undefined, () => new Date(soldAt));
  return { database, sale };
}

const draft = (saleId: string, fields: Partial<VoidDraft> = {}): VoidDraft => ({
  saleId,
  reason: 'Rung up twice',
  approval: MANAGER,
  ...fields,
});

const voidIt = (database: PosDatabase, request: VoidDraft, at = LATER) =>
  commitVoid(request, { database, now: () => new Date(at) });

const voidMovements = (database: PosDatabase) =>
  database.stockMovements.filter((movement) => movement.reason === 'void').toArray();

/** The sale as it was, and nothing a void would write. */
async function expectNotVoided(database: PosDatabase, saleId: string, outboxSeq = 1) {
  expect((await database.sales.get(saleId))?.status).toBe('completed');
  expect(await voidMovements(database)).toEqual([]);
  expect(await database.outbox.where('seq').above(outboxSeq).count()).toBe(0);
  expect(await getSetting(database, 'outboxSeq')).toBe(outboxSeq);
}

async function expectRefused(run: Promise<unknown>, code: VoidFailure): Promise<void> {
  await expect(run).rejects.toMatchObject({ name: 'VoidRefusedError', code });
}

describe('commitVoid: what is written', () => {
  it('marks the sale voided, puts the stock back and queues the event', async () => {
    const { database, sale } = await soldOne();

    const committed = await voidIt(database, draft(sale.id));

    expect(await database.sales.get(sale.id)).toEqual({
      ...sale,
      status: 'voided',
      voidedAt: LATER,
      voidReason: 'Rung up twice',
    });
    expect(committed.sale).toEqual(await database.sales.get(sale.id));
    const movement = {
      id: expect.any(String) as string,
      reason: 'void',
      sourceType: 'sale',
      sourceId: sale.id,
      seq: 2,
      synced: 0,
      occurredAt: LATER,
    };
    const movements = await voidMovements(database);
    expect(movements).toHaveLength(2);
    expect(movements).toEqual(
      expect.arrayContaining([
        { ...movement, variantId: LINEN_ID, delta: 2 },
        { ...movement, variantId: TEE_ID, delta: 1 },
      ]),
    );
    expect(await getAvailable(database, LINEN_ID)).toBe(1);
    expect(await getAvailable(database, TEE_ID)).toBe(5);

    const row = (await database.outbox.get(2))!;
    expect(row.status).toBe('pending');
    const event = toSyncEvent(row);
    expect(syncEventSchema.parse(event)).toEqual(event);
    expect(event).toEqual({
      eventId: committed.eventId,
      terminalId: TERMINAL_ID,
      seq: 2,
      type: 'SALE_VOIDED',
      schemaVersion: 1,
      occurredAt: LATER,
      payload: {
        saleId: sale.id,
        receiptNo: 'S01-T1-000001',
        // The manager who allowed it.
        staffId: MANAGER_ID,
        reason: 'Rung up twice',
      },
    });
    expect(await getSetting(database, 'outboxSeq')).toBe(2);
    expect(await getSetting(database, 'receiptSeq')).toBe(1);
    expect(await getSetting(database, 'returnSeq')).toBe(0);
  });

  it('takes no reason as none, and shortens a long one', async () => {
    const database = await seedShop();
    const first = await makeSale(database, cart(), undefined, () => new Date(SOLD));
    const second = await makeSale(database, cart(), undefined, () => new Date(SOLD));

    const blank = await voidIt(database, draft(first.sale.id, { reason: '  ' }));
    const long = await voidIt(database, draft(second.sale.id, { reason: 'x'.repeat(600) }));

    expect(blank.sale.voidReason).toBeNull();
    expect(long.sale.voidReason).toHaveLength(500);
  });

  it.each([
    ['across a change of UTC date', '2026-11-26T21:00:00.000Z', LATER],
    ['on the day summer time starts', '2026-10-03T14:30:00.000Z', '2026-10-04T12:30:00.000Z'],
  ])('allows a void %s on one store day', async (_, soldAt, voidedAt) => {
    const { database, sale } = await soldOne(soldAt);

    await expect(voidIt(database, draft(sale.id), voidedAt)).resolves.toBeDefined();
  });
});

describe('commitVoid: refusals', () => {
  it('refuses another terminal’s sale', async () => {
    const { database, sale } = await soldOne();
    await database.sales.update(sale.id, { terminalId: OTHER_SALE_ID });

    await expectRefused(voidIt(database, draft(sale.id)), 'OTHER_TERMINAL');

    await expectNotVoided(database, sale.id);
  });

  it('refuses a sale that is not stored here', async () => {
    const { database, sale } = await soldOne();

    await expectRefused(voidIt(database, draft(OTHER_SALE_ID)), 'OTHER_TERMINAL');

    await expectNotVoided(database, sale.id);
  });

  it('refuses a sale of the previous day, even two minutes later', async () => {
    // 23:59 and 00:01 in Sydney.
    const { database, sale } = await soldOne('2026-11-26T12:59:00.000Z');

    await expectRefused(voidIt(database, draft(sale.id), '2026-11-26T13:01:00.000Z'), 'NOT_TODAY');

    await expectNotVoided(database, sale.id);
  });

  it('refuses a sale with a return', async () => {
    const { database, sale } = await soldOne();
    await commitReturn(
      {
        ref: { kind: 'local', saleId: sale.id },
        selections: [{ lineNo: 2, qty: 1, restock: false }],
        reason: 'Faulty',
        method: 'cash',
        cardReference: null,
        staffId: null,
        approval: null,
      },
      { database },
    );

    await expectRefused(voidIt(database, draft(sale.id)), 'HAS_RETURNS');

    await expectNotVoided(database, sale.id, 2);
  });

  it('refuses a second void, also when both are asked at once', async () => {
    const { database, sale } = await soldOne();

    const results = await Promise.allSettled([
      voidIt(database, draft(sale.id)),
      voidIt(database, draft(sale.id)),
    ]);
    await expectRefused(voidIt(database, draft(sale.id)), 'ALREADY_VOIDED');

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await voidMovements(database)).toHaveLength(2);
    expect(await database.outbox.count()).toBe(2);
  });

  it.each([
    ['no manager PIN', null],
    ['a cashier', CASHIER],
    ['a cashier claiming to be a manager', { ...CASHIER, role: 'manager' as const }],
  ])('refuses a void with %s', async (_, approval) => {
    const { database, sale } = await soldOne();

    await expectRefused(voidIt(database, draft(sale.id, { approval })), 'APPROVAL_REQUIRED');

    await expectNotVoided(database, sale.id);
  });

  it('refuses a manager who has since been retired', async () => {
    const { database, sale } = await soldOne();
    await database.staff.update(MANAGER_ID, { isActive: false });

    await expectRefused(voidIt(database, draft(sale.id)), 'APPROVAL_REQUIRED');
  });

  it('refuses on a terminal that is not set up', async () => {
    const { database, sale } = await soldOne();
    await database.settings.delete('outboxSeq');

    await expectRefused(voidIt(database, draft(sale.id)), 'NOT_READY');
  });

  it('leaves a voided sale with nothing to return', async () => {
    const { database, sale } = await soldOne();
    await voidIt(database, draft(sale.id));

    await expect(
      commitReturn(
        {
          ref: { kind: 'local', saleId: sale.id },
          selections: [{ lineNo: 1, qty: 1, restock: true }],
          reason: 'Faulty',
          method: 'cash',
          cardReference: null,
          staffId: null,
          approval: MANAGER,
        },
        { database },
      ),
    ).rejects.toMatchObject({ code: 'SALE_VOIDED' });
  });
});

describe('loadVoidState', () => {
  it('says whether a sale can be voided, and why not', async () => {
    const { database, sale } = await soldOne();
    const refusalAt = async (saleId: string, at: string) =>
      (await loadVoidState(database, saleId, new Date(at)))?.refusal;

    await expect(refusalAt(sale.id, LATER)).resolves.toBeNull();
    await expect(refusalAt(sale.id, '2026-11-28T05:00:00.000Z')).resolves.toBe('NOT_TODAY');
    await expect(refusalAt(OTHER_SALE_ID, LATER)).resolves.toBe('OTHER_TERMINAL');
  });
});

describe('commitVoid: all or nothing', () => {
  const fail = () => {
    throw new Error('power cut');
  };

  it.each([
    ['sales', 'updating'],
    ['stockMovements', 'creating'],
    ['outbox', 'creating'],
    ['settings', 'updating'],
  ] as const)('leaves the sale as it was if %s fails while %s', async (table, operation) => {
    const { database, sale } = await soldOne();
    database[table].hook(operation as 'creating', fail);

    await expect(voidIt(database, draft(sale.id))).rejects.toThrow();

    await expectNotVoided(database, sale.id);
  });
});
