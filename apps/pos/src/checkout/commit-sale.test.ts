import { calculateCart, sumCents, syncEventSchema } from '@pos/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { db, PosDatabase } from '../db/database';
import { getSetting } from '../db/settings-repo';
import { getAvailable } from '../db/stock-repo';
import { TERMINAL_ID } from '../test/api-fixtures';
import { cart, cartLine, CASHIER_ID, LINEN_ID, readyDb, TEE_ID } from '../test/checkout-fixtures';
import { STORE_ID, storeFixture } from '../test/fixtures';
import { createTestDb } from '../test/test-db';
import { CheckoutError } from './checkout-error';
import { commitSale } from './commit-sale';
import type { SaleDraft, TenderInput } from './sale-draft';

const NOW = new Date('2026-11-20T02:30:00.000Z');
const cash = (tenderedCents = 20_000): TenderInput => ({ method: 'cash', tenderedCents });
const card: TenderInput = { method: 'card' };

const twoLines = cart({
  lines: [
    cartLine(),
    cartLine({
      variantId: TEE_ID,
      sku: 'TEE-NVY-L',
      name: 'Summer Tee — Navy / L',
      qty: 2,
      unitPriceCents: 3500,
    }),
  ],
});

const sell = (database: PosDatabase, draft: SaleDraft = cart(), tender: TenderInput = cash()) =>
  commitSale(draft, tender, { database, now: () => NOW });

const WRITTEN = ['sales', 'saleLines', 'payments', 'stockMovements', 'outbox'] as const;

async function expectNothingWritten(database: PosDatabase, receiptSeq = 0, outboxSeq = 0) {
  for (const table of WRITTEN) {
    expect(await database[table].count(), table).toBe(0);
  }
  expect(await getSetting(database, 'receiptSeq')).toBe(receiptSeq);
  expect(await getSetting(database, 'outboxSeq')).toBe(outboxSeq);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('commitSale: what is written', () => {
  it('stores the sale, its lines and payment with the totals from core', async () => {
    const database = await readyDb();

    const committed = await sell(database, twoLines);

    expect(await database.sales.toArray()).toEqual([
      {
        id: committed.sale.id,
        receiptNo: 'S01-T1-000001',
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
        staffId: CASHIER_ID,
        status: 'completed',
        cartDiscount: null,
        subtotalCents: 15_900,
        discountCents: 0,
        taxCents: 1445,
        roundingCents: 0,
        totalCents: 15_900,
        occurredAt: NOW.toISOString(),
      },
    ]);
    const lines = await database.saleLines
      .where('saleId')
      .equals(committed.sale.id)
      .sortBy('lineNo');
    expect(lines).toEqual(committed.lines);
    expect(lines[1]).toEqual({
      id: expect.any(String) as string,
      saleId: committed.sale.id,
      lineNo: 2,
      variantId: TEE_ID,
      skuSnapshot: 'TEE-NVY-L',
      nameSnapshot: 'Summer Tee — Navy / L',
      qty: 2,
      unitPriceCents: 3500,
      discount: null,
      lineDiscountCents: 0,
      taxCents: 636,
      lineTotalCents: 7000,
    });
    expect(await database.payments.toArray()).toEqual([
      {
        id: committed.payment.id,
        saleId: committed.sale.id,
        method: 'cash',
        amountCents: 15_900,
        tenderedCents: 20_000,
        changeCents: 4100,
        cardReference: null,
        cardLast4: null,
      },
    ]);
  });

  it('writes one unsynced stock movement per line, tied to the outbox seq', async () => {
    const database = await readyDb({ outboxSeq: 6 });

    const { sale } = await sell(database, twoLines);

    const movements = await database.stockMovements.orderBy('id').toArray();
    const common = {
      id: expect.any(String) as string,
      reason: 'sale',
      sourceType: 'sale',
      sourceId: sale.id,
      seq: 7,
      synced: 0,
      occurredAt: NOW.toISOString(),
    };
    expect(movements).toEqual([
      { ...common, variantId: LINEN_ID, delta: -1 },
      { ...common, variantId: TEE_ID, delta: -2 },
    ]);
  });

  it('queues a pending event that satisfies the shared contract', async () => {
    const database = await readyDb();

    const committed = await sell(database, twoLines);

    const [row] = await database.outbox.toArray();
    const { status, ...event } = row!;
    expect(status).toBe('pending');
    expect(syncEventSchema.parse(event)).toEqual(event);
    expect(event).toMatchObject({
      seq: 1,
      eventId: committed.eventId,
      terminalId: TERMINAL_ID,
      type: 'SALE_COMPLETED',
      schemaVersion: 1,
      occurredAt: NOW.toISOString(),
      payload: {
        saleId: committed.sale.id,
        receiptNo: 'S01-T1-000001',
        storeId: STORE_ID,
        staffId: CASHIER_ID,
        totalCents: 15_900,
      },
    });
  });

  it('advances both counters', async () => {
    const database = await readyDb();

    await sell(database);

    expect(await getSetting(database, 'receiptSeq')).toBe(1);
    expect(await getSetting(database, 'outboxSeq')).toBe(1);
    expect(await getSetting(database, 'returnSeq')).toBe(0);
  });

  it('uses the price in the cart, whatever the catalogue says now', async () => {
    const database = await readyDb();

    const { sale } = await sell(database, cart({ lines: [cartLine({ unitPriceCents: 100 })] }));

    expect(sale.totalCents).toBe(100);
  });

  it('sends totals the server will agree with (ARCH §5.4)', async () => {
    const database = await readyDb();
    await sell(
      database,
      cart({
        lines: [
          cartLine({ qty: 3, unitPriceCents: 3333, discount: { type: 'percent', value: 15 } }),
          cartLine({ variantId: TEE_ID, unitPriceCents: 1999 }),
        ],
        cartDiscount: { type: 'fixed', value: 777 },
      }),
    );

    const row = (await database.outbox.get(1))!;
    if (row.type !== 'SALE_COMPLETED') throw new Error('expected a sale');
    const { payload } = row;
    const expected = calculateCart(
      payload.lines,
      payload.cartDiscount,
      { ...storeFixture, storeId: storeFixture.id },
      'cash',
    );

    expect(payload).toMatchObject({
      subtotalCents: expected.subtotalCents,
      discountCents: expected.discountCents,
      taxCents: expected.taxCents,
      roundingCents: expected.roundingCents,
      totalCents: expected.totalCents,
      cartDiscount: { type: 'fixed', value: 777 },
    });
    expect(payload.lines[0]!.discount).toEqual({ type: 'percent', value: 15 });
    expect(payload.lines.map((line) => line.lineTotalCents)).toEqual(
      expected.lines.map((line) => line.lineTotalCents),
    );
    expect(sumCents(payload.payments.map((payment) => payment.amountCents))).toBe(
      payload.totalCents,
    );
  });

  it('works with the app database when none is given', async () => {
    await readyDb({}, db);

    const { sale } = await commitSale(cart(), cash());

    expect(await db.sales.get(sale.id)).toBeDefined();
  });
});

describe('commitSale: tender', () => {
  it.each([
    [1002, 1000, -2],
    [1003, 1005, 2],
  ])('rounds a cash total of %i to %i', async (price, total, rounding) => {
    const database = await readyDb();

    const { sale, payment } = await sell(
      database,
      cart({ lines: [cartLine({ unitPriceCents: price })] }),
      cash(total),
    );

    expect(sale).toMatchObject({ totalCents: total, roundingCents: rounding });
    expect(payment).toMatchObject({ amountCents: total, tenderedCents: total, changeCents: 0 });
  });

  it('charges a card the exact amount and keeps only the reference and last four', async () => {
    const database = await readyDb();

    const { sale, payment } = await sell(
      database,
      cart({ lines: [cartLine({ unitPriceCents: 1002 })] }),
      { method: 'card', cardReference: '  APPROVED 4411  ', cardLast4: '4242' },
    );

    expect(sale).toMatchObject({ totalCents: 1002, roundingCents: 0 });
    expect(payment).toMatchObject({
      method: 'card',
      amountCents: 1002,
      tenderedCents: null,
      changeCents: null,
      cardReference: 'APPROVED 4411',
      cardLast4: '4242',
    });
  });

  it('stores a blank card reference and last four as null', async () => {
    const database = await readyDb();

    const { payment } = await sell(database, cart(), {
      method: 'card',
      cardReference: '   ',
      cardLast4: '',
    });

    expect(payment).toMatchObject({ cardReference: null, cardLast4: null });
  });

  it('records a $0 payment on a fully discounted sale', async () => {
    const database = await readyDb();

    const { payment } = await sell(
      database,
      cart({ cartDiscount: { type: 'percent', value: 100 } }),
      cash(0),
    );

    expect(payment).toMatchObject({ amountCents: 0, tenderedCents: 0, changeCents: 0 });
    expect(await database.payments.count()).toBe(1);
  });
});

describe('commitSale: refusals before anything is written', () => {
  const lines = (count: number) => Array.from({ length: count }, () => cartLine());
  const withLine = (fields: Parameters<typeof cartLine>[0]) => cart({ lines: [cartLine(fields)] });

  it.each<[string, SaleDraft, TenderInput, CheckoutError['code']]>([
    ['an empty cart', cart({ lines: [] }), cash(), 'EMPTY_CART'],
    ['cash one cent short', cart(), cash(8899), 'INSUFFICIENT_TENDER'],
    ['a fraction of a cent tendered', cart(), cash(9000.5), 'INVALID_SALE'],
    ['negative cash', cart(), cash(-1), 'INVALID_SALE'],
    ['quantity 0', withLine({ qty: 0 }), cash(), 'INVALID_SALE'],
    ['a fractional quantity', withLine({ qty: 1.5 }), cash(), 'INVALID_SALE'],
    ['a negative price', withLine({ unitPriceCents: -1 }), cash(), 'INVALID_SALE'],
    [
      'a total beyond the database limit',
      withLine({ unitPriceCents: 2_000_000_000, qty: 2 }),
      card,
      'INVALID_SALE',
    ],
    [
      'a discount above 100 %',
      withLine({ discount: { type: 'percent', value: 101 } }),
      cash(),
      'INVALID_SALE',
    ],
    ['201 lines', cart({ lines: lines(201) }), card, 'INVALID_SALE'],
    ['an empty SKU', withLine({ sku: '' }), cash(), 'INVALID_SALE'],
    ['a staff id that is not a UUID', cart({ staffId: 'casey' }), cash(), 'INVALID_SALE'],
    ['a five-digit last four', cart(), { method: 'card', cardLast4: '12345' }, 'INVALID_SALE'],
    [
      'a card reference over 64 characters',
      cart(),
      { method: 'card', cardReference: 'x'.repeat(65) },
      'INVALID_SALE',
    ],
    [
      'a card reference the server cannot store',
      cart(),
      { method: 'card', cardReference: 'ref\u0000' },
      'INVALID_SALE',
    ],
  ])('refuses %s', async (_, draft, tender, code) => {
    const database = await readyDb();

    await expect(sell(database, draft, tender)).rejects.toMatchObject({
      name: 'CheckoutError',
      code,
    });
    await expectNothingWritten(database);
  });

  it('accepts a sale of exactly 200 lines', async () => {
    const database = await readyDb();

    await sell(database, cart({ lines: lines(200) }), card);

    expect(await database.saleLines.count()).toBe(200);
  });

  it.each([
    ['is not enrolled', {}],
    ['has not pulled yet', { terminalId: TERMINAL_ID, terminalCode: 'T1', receiptSeq: 0 }],
  ])('refuses when the terminal %s', async (_, settings) => {
    const database = createTestDb();
    await database.settings.bulkPut(
      Object.entries(settings).map(([key, value]) => ({ key: key as 'receiptSeq', value })),
    );

    await expect(sell(database)).rejects.toMatchObject({ code: 'NOT_READY' });
    expect(await database.sales.count()).toBe(0);
    expect(await database.outbox.count()).toBe(0);
  });
});

describe('commitSale: snapshots', () => {
  it('shortens long texts without splitting a character', async () => {
    const database = await readyDb();

    const { lines } = await sell(
      database,
      cart({
        lines: [cartLine({ sku: 'S'.repeat(70), name: `${'n'.repeat(199)}😀 tail` })],
      }),
    );

    expect(lines[0]!.skuSnapshot).toBe('S'.repeat(64));
    expect(lines[0]!.nameSnapshot).toBe('n'.repeat(199));
  });

  it('removes characters the server database cannot store', async () => {
    const database = await readyDb();

    const { lines } = await sell(
      database,
      cart({ lines: [cartLine({ name: 'Linen\u0000 Shirt \ud800— M' })] }),
    );

    expect(lines[0]!.nameSnapshot).toBe('Linen Shirt — M');
  });
});

describe('commitSale: atomicity (ARCH §4.2)', () => {
  const fail = () => {
    throw new Error('power cut');
  };

  it.each(WRITTEN)('leaves nothing behind if writing %s fails', async (table) => {
    const database = await readyDb({ receiptSeq: 10, outboxSeq: 20 });
    database[table].hook('creating', fail);

    await expect(sell(database, twoLines)).rejects.toThrow();

    await expectNothingWritten(database, 10, 20);
    database[table].hook('creating').unsubscribe(fail);
    const { seq, sale } = await sell(database);
    expect(seq).toBe(21);
    expect(sale.receiptNo).toBe('S01-T1-000011');
  });

  it('leaves nothing behind if writing the counters fails', async () => {
    const database = await readyDb();
    database.settings.hook('updating', fail);

    await expect(sell(database, twoLines)).rejects.toThrow();

    await expectNothingWritten(database);
  });

  it('rolls back everything when the last write hits a real constraint', async () => {
    const database = await readyDb();
    await sell(database);
    // As if the counter had gone backwards: seq 2 is already taken.
    await database.outbox.add({ ...(await database.outbox.get(1))!, seq: 2, eventId: 'other' });

    await expect(sell(database)).rejects.toThrow(/constraint/i);

    expect(await database.sales.count()).toBe(1);
    expect(await database.stockMovements.count()).toBe(1);
    expect(await getSetting(database, 'receiptSeq')).toBe(1);
    expect(await getSetting(database, 'outboxSeq')).toBe(1);
  });
});

describe('commitSale: counters', () => {
  const oneToN = (n: number) => Array.from({ length: n }, (_, index) => index + 1);
  const receipt = (n: number) => `S01-T1-${String(n).padStart(6, '0')}`;

  const seqs = async (database: PosDatabase) =>
    (await database.outbox.toArray()).map((row) => row.seq);
  const receiptNos = async (database: PosDatabase) =>
    (await database.sales.orderBy('receiptNo').toArray()).map((sale) => sale.receiptNo);

  it('gives 100 sequential sales seq 1 to 100 with no gaps', async () => {
    const database = await readyDb();

    for (let sale = 0; sale < 100; sale += 1) await sell(database);

    expect(await seqs(database)).toEqual(oneToN(100));
    expect(await receiptNos(database)).toEqual(oneToN(100).map(receipt));
    expect(await getSetting(database, 'outboxSeq')).toBe(100);
    expect(await getSetting(database, 'receiptSeq')).toBe(100);
  });

  it('stays gap-free when sales are committed at the same moment', async () => {
    const database = await readyDb();

    const committed = await Promise.all(oneToN(25).map(() => sell(database)));

    expect(committed.map((sale) => sale.seq).sort((a, b) => a - b)).toEqual(oneToN(25));
    expect(await receiptNos(database)).toEqual(oneToN(25).map(receipt));
  });

  it('stays gap-free across two tabs on one device', async () => {
    const firstTab = await readyDb();
    const secondTab = new PosDatabase(firstTab.name);

    await Promise.all(oneToN(20).map((n) => sell(n % 2 ? firstTab : secondTab)));

    expect(await seqs(firstTab)).toEqual(oneToN(20));
    expect(await receiptNos(firstTab)).toEqual(oneToN(20).map(receipt));
  });

  it('uses no number for a sale that failed', async () => {
    const database = await readyDb();

    await sell(database);
    await expect(sell(database, cart(), cash(1))).rejects.toThrow(CheckoutError);
    await sell(database);

    expect(await seqs(database)).toEqual([1, 2]);
    expect(await receiptNos(database)).toEqual([receipt(1), receipt(2)]);
  });

  it('continues from the high-water marks of a re-enrolled terminal', async () => {
    const database = await readyDb({ receiptSeq: 123, outboxSeq: 41 });

    const { seq, sale } = await sell(database);

    expect(seq).toBe(42);
    expect(sale.receiptNo).toBe('S01-T1-000124');
  });

  it('continues after the app restarts', async () => {
    const first = await readyDb();
    await sell(first);
    first.close();

    const second = new PosDatabase(first.name);
    const { seq } = await sell(second);

    expect(seq).toBe(2);
    expect(await second.sales.count()).toBe(2);
  });
});

describe('commitSale: offline', () => {
  it('never touches the network', async () => {
    const network = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', network);
    const database = await readyDb();

    await sell(database);

    expect(network).not.toHaveBeenCalled();
  });

  it('lowers the available stock at once', async () => {
    const database = await readyDb();
    await database.inventory.add({ variantId: LINEN_ID, serverOnHand: 1 });

    await sell(database);
    expect(await getAvailable(database, LINEN_ID)).toBe(0);

    // The system shows none, and the sale still goes through (ARCH §5.3).
    await sell(database);
    expect(await getAvailable(database, LINEN_ID)).toBe(-1);
  });
});
