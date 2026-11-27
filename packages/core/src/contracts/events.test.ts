import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';

import type { Discount } from '../discounts.js';
import {
  eventEnvelopeSchema,
  EVENT_TYPES,
  eventTypeSchema,
  returnCompletedPayloadSchema,
  saleCompletedPayloadSchema,
  saleVoidedPayloadSchema,
  SCHEMA_VERSION,
  syncEventSchema,
  type ReturnCompletedEvent,
  type SaleCompletedEvent,
  type SaleVoidedEvent,
  type SyncEvent,
} from './events.js';
import { discountSchema } from './primitives.js';

const v7 = (n: number) => `01920f3a-7b2c-7000-8000-${String(n).padStart(12, '0')}`;
const UUID_V4 = '11111111-1111-4111-8111-111111111111';
const STORE_ID = '22222222-2222-4222-8222-222222222222';
const TERMINAL_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';
const VARIANT_ID = '55555555-5555-4555-8555-555555555555';

const saleLine = {
  lineId: v7(2),
  lineNo: 1,
  variantId: VARIANT_ID,
  skuSnapshot: 'LIN-BK-M',
  nameSnapshot: 'Linen Shirt — Black / M',
  qty: 1,
  unitPriceCents: 8900,
  discount: null,
  lineDiscountCents: 0,
  taxCents: 809,
  lineTotalCents: 8900,
};

const payment = {
  paymentId: v7(3),
  method: 'cash',
  amountCents: 8900,
  tenderedCents: 10_000,
  changeCents: 1100,
  cardReference: null,
  cardLast4: null,
};

const salePayload = {
  saleId: v7(1),
  receiptNo: 'S01-T2-000123',
  storeId: STORE_ID,
  staffId: STAFF_ID,
  cartDiscount: null,
  subtotalCents: 8900,
  discountCents: 0,
  taxCents: 809,
  roundingCents: 0,
  totalCents: 8900,
  lines: [saleLine],
  payments: [payment],
};

const voidPayload = {
  saleId: v7(1),
  receiptNo: 'S01-T2-000123',
  staffId: STAFF_ID,
  reason: 'Rung up twice',
};

const returnLine = {
  returnLineId: v7(5),
  saleLineNo: 1,
  variantId: VARIANT_ID,
  qty: 1,
  refundCents: 8900,
  restock: true,
};

const refund = { refundId: v7(6), method: 'cash', amountCents: 8900, cardReference: null };

const returnPayload = {
  returnId: v7(4),
  returnNo: 'R-S01-T2-000017',
  originalSaleId: v7(1),
  storeId: STORE_ID,
  staffId: STAFF_ID,
  reason: 'Wrong size',
  refundTotalCents: 8900,
  roundingCents: 0,
  lines: [returnLine],
  refunds: [refund],
};

const envelope = {
  eventId: v7(100),
  terminalId: TERMINAL_ID,
  seq: 41,
  schemaVersion: 1,
  occurredAt: '2026-11-26T03:15:00.000Z',
};

const saleEvent = { ...envelope, type: 'SALE_COMPLETED', payload: salePayload };
const voidEvent = { ...envelope, type: 'SALE_VOIDED', payload: voidPayload };
const returnEvent = { ...envelope, type: 'RETURN_COMPLETED', payload: returnPayload };

const accepts = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('event constants', () => {
  it('lists the three event types at schema version 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(EVENT_TYPES).toEqual(['SALE_COMPLETED', 'SALE_VOIDED', 'RETURN_COMPLETED']);
    expect(accepts(eventTypeSchema, 'SALE_VOIDED')).toBe(true);
    expect(accepts(eventTypeSchema, 'SALE_DELETED')).toBe(false);
  });
});

describe('syncEventSchema', () => {
  it.each([saleEvent, voidEvent, returnEvent])('accepts a valid $type event', (event) => {
    expect(syncEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    ['a UUIDv4 eventId', { eventId: UUID_V4 }],
    ['a non-UUID terminalId', { terminalId: 'T2' }],
    ['seq 0', { seq: 0 }],
    ['a fractional seq', { seq: 1.5 }],
    ['a string seq', { seq: '41' }],
    ['an unsafe seq', { seq: 2 ** 53 }],
    ['an unknown schema version', { schemaVersion: 2 }],
    ['an unknown type', { type: 'SALE_DELETED' }],
    ['a non-UTC time', { occurredAt: '2026-11-26T14:15:00+11:00' }],
    ['a date without a time', { occurredAt: '2026-11-26' }],
    ['a missing payload', { payload: undefined }],
    ['a payload of another type', { payload: voidPayload }],
  ])('rejects %s', (_label, change) => {
    expect(accepts(syncEventSchema, { ...saleEvent, ...change })).toBe(false);
  });

  it('narrows the payload by type', () => {
    expectTypeOf<
      Extract<SyncEvent, { type: 'SALE_COMPLETED' }>
    >().toEqualTypeOf<SaleCompletedEvent>();
    expectTypeOf<Extract<SyncEvent, { type: 'SALE_VOIDED' }>>().toEqualTypeOf<SaleVoidedEvent>();
    expectTypeOf<
      Extract<SyncEvent, { type: 'RETURN_COMPLETED' }>
    >().toEqualTypeOf<ReturnCompletedEvent>();
  });
});

describe('eventEnvelopeSchema', () => {
  it.each([
    ['a junk payload', { payload: { nonsense: true } }],
    ['an unknown type', { type: 'SOMETHING_NEW' }],
    ['a newer schema version', { schemaVersion: 2 }],
    ['a missing payload', { payload: undefined }],
  ])('lets through %s, so the server can reject it and move on', (_label, change) => {
    const event = { ...saleEvent, ...change };
    expect(accepts(eventEnvelopeSchema, event)).toBe(true);
    expect(accepts(syncEventSchema, event)).toBe(false);
  });

  it('keeps the payload untouched', () => {
    const payload = { extra: 1, nested: { value: 'x' } };
    expect(eventEnvelopeSchema.parse({ ...saleEvent, payload }).payload).toEqual(payload);
  });

  it.each([
    ['eventId', { eventId: 'abc' }],
    ['seq', { seq: -1 }],
    ['type', { type: '' }],
    ['occurredAt', { occurredAt: 'yesterday' }],
  ])('still rejects a bad %s', (_label, change) => {
    expect(accepts(eventEnvelopeSchema, { ...saleEvent, ...change })).toBe(false);
  });
});

describe('saleCompletedPayloadSchema', () => {
  const sale = (change: object) =>
    accepts(saleCompletedPayloadSchema, { ...salePayload, ...change });
  const saleWithLine = (change: object) => sale({ lines: [{ ...saleLine, ...change }] });
  const saleWithPayment = (change: object) => sale({ payments: [{ ...payment, ...change }] });

  it('accepts a discounted card sale without a staff member', () => {
    expect(
      sale({
        staffId: null,
        cartDiscount: { type: 'percent', value: 10 },
        lines: [{ ...saleLine, discount: { type: 'fixed', value: 500 } }],
        payments: [
          {
            ...payment,
            method: 'card',
            tenderedCents: null,
            changeCents: null,
            cardReference: 'APPROVED-1',
            cardLast4: '0042',
          },
        ],
      }),
    ).toBe(true);
  });

  it('accepts totals that do not add up, because the server only flags them', () => {
    expect(sale({ subtotalCents: 1, discountCents: 2, taxCents: 3, totalCents: 99_999 })).toBe(
      true,
    );
    expect(saleWithLine({ lineTotalCents: 1 })).toBe(true);
    expect(saleWithPayment({ amountCents: 1, tenderedCents: 0 })).toBe(true);
  });

  it('accepts negative cash rounding', () => {
    expect(sale({ roundingCents: -2 })).toBe(true);
  });

  it.each([
    ['float money', { totalCents: 89.5 }],
    ['string money', { totalCents: '8900' }],
    ['money beyond int4', { totalCents: 2_147_483_648 }],
    ['a negative total', { totalCents: -1 }],
    ['a malformed receipt number', { receiptNo: 'S01-T2-123' }],
    ['a lower-case receipt number', { receiptNo: 's01-t2-000123' }],
    ['a return number as receipt number', { receiptNo: 'R-S01-T2-000017' }],
    ['a UUIDv4 saleId', { saleId: UUID_V4 }],
    ['a missing staffId', { staffId: undefined }],
    ['a 101 % cart discount', { cartDiscount: { type: 'percent', value: 101 } }],
    ['a fractional cart percentage', { cartDiscount: { type: 'percent', value: 12.5 } }],
    ['no lines', { lines: [] }],
    ['no payments', { payments: [] }],
    ['a repeated line number', { lines: [saleLine, { ...saleLine, lineId: v7(9) }] }],
    ['a repeated line id', { lines: [saleLine, { ...saleLine, lineNo: 2 }] }],
    ['a repeated payment id', { payments: [payment, payment] }],
  ])('rejects %s', (_label, change) => {
    expect(sale(change)).toBe(false);
  });

  it.each([
    ['qty 0', { qty: 0 }],
    ['a fractional qty', { qty: 1.5 }],
    ['line number 0', { lineNo: 0 }],
    ['a negative unit price', { unitPriceCents: -1 }],
    ['a negative line total', { lineTotalCents: -1 }],
    ['an empty SKU', { skuSnapshot: '' }],
    ['an over-long name', { nameSnapshot: 'x'.repeat(201) }],
    ['a non-UUID variant', { variantId: 'LIN-BK-M' }],
    ['a negative fixed discount', { discount: { type: 'fixed', value: -1 } }],
  ])('rejects a line with %s', (_label, change) => {
    expect(saleWithLine(change)).toBe(false);
  });

  it.each([
    ['an unknown method', { method: 'voucher' }],
    ['a three-digit card number', { cardLast4: '123' }],
    ['a full card number', { cardLast4: '4111111111111111' }],
    ['letters as last four digits', { cardLast4: 'abcd' }],
  ])('rejects a payment with %s', (_label, change) => {
    expect(saleWithPayment(change)).toBe(false);
  });
});

describe('saleVoidedPayloadSchema', () => {
  it('accepts a void with or without a reason', () => {
    expect(accepts(saleVoidedPayloadSchema, voidPayload)).toBe(true);
    expect(accepts(saleVoidedPayloadSchema, { ...voidPayload, reason: null })).toBe(true);
  });

  it.each([
    ['a missing saleId', { saleId: undefined }],
    ['a malformed receipt number', { receiptNo: '123' }],
    ['an over-long reason', { reason: 'x'.repeat(501) }],
  ])('rejects %s', (_label, change) => {
    expect(accepts(saleVoidedPayloadSchema, { ...voidPayload, ...change })).toBe(false);
  });
});

describe('returnCompletedPayloadSchema', () => {
  const returned = (change: object) =>
    accepts(returnCompletedPayloadSchema, { ...returnPayload, ...change });
  const returnedLine = (change: object) => returned({ lines: [{ ...returnLine, ...change }] });

  it('accepts a damaged item refunded to store credit', () => {
    expect(
      returned({
        lines: [{ ...returnLine, restock: false }],
        refunds: [{ ...refund, method: 'store_credit' }],
      }),
    ).toBe(true);
  });

  it('accepts amounts that do not add up', () => {
    expect(returned({ refundTotalCents: 1, roundingCents: -2 })).toBe(true);
  });

  it.each([
    ['a receipt number as return number', { returnNo: 'S01-T2-000017' }],
    ['a UUIDv4 originalSaleId', { originalSaleId: UUID_V4 }],
    ['a negative refund total', { refundTotalCents: -1 }],
    ['float rounding', { roundingCents: 0.5 }],
    ['no lines', { lines: [] }],
    ['no refunds', { refunds: [] }],
    ['a repeated sale line', { lines: [returnLine, { ...returnLine, returnLineId: v7(9) }] }],
    ['a repeated return line id', { lines: [returnLine, { ...returnLine, saleLineNo: 2 }] }],
    ['a repeated refund id', { refunds: [refund, refund] }],
    ['an unknown refund method', { refunds: [{ ...refund, method: 'cheque' }] }],
  ])('rejects %s', (_label, change) => {
    expect(returned(change)).toBe(false);
  });

  it.each([
    ['qty 0', { qty: 0 }],
    ['sale line 0', { saleLineNo: 0 }],
    ['a negative refund', { refundCents: -1 }],
    ['a missing restock flag', { restock: undefined }],
  ])('rejects a line with %s', (_label, change) => {
    expect(returnedLine(change)).toBe(false);
  });
});

describe('discountSchema', () => {
  it('matches the Discount type used for pricing', () => {
    expectTypeOf<z.infer<typeof discountSchema>>().toEqualTypeOf<Discount>();
  });

  it.each([
    { type: 'percent', value: 0 },
    { type: 'percent', value: 100 },
    { type: 'fixed', value: 0 },
  ])('accepts %o', (discount) => {
    expect(accepts(discountSchema, discount)).toBe(true);
  });

  it.each([
    { type: 'percent', value: -1 },
    { type: 'fixed', value: 1.5 },
    { type: 'bogo', value: 1 },
  ])('rejects %o', (discount) => {
    expect(accepts(discountSchema, discount)).toBe(false);
  });
});
