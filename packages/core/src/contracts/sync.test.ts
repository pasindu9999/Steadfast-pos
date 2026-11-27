import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { apiErrorSchema, ERROR_CODES, errorCodeSchema } from './errors.js';
import {
  healthResponseSchema,
  PUSH_BATCH_MAX,
  pullQuerySchema,
  pullResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
  seqGapResponseSchema,
} from './sync.js';

const v7 = (n: number) => `01920f3a-7b2c-7000-8000-${String(n).padStart(12, '0')}`;
const ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-11-26T03:15:00.000Z';

const accepts = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe('error contracts', () => {
  it('has stable codes', () => {
    expect(ERROR_CODES).toEqual([
      'SEQ_GAP',
      'SEQ_REUSED',
      'OVER_RETURN',
      'INVALID_PAYLOAD',
      'VALIDATION_FAILED',
      'UNAUTHORIZED',
      'TERMINAL_MISMATCH',
      'RATE_LIMITED',
      'NOT_FOUND',
      'PAYLOAD_TOO_LARGE',
      'INVALID_ENROLMENT_CODE',
      'INTERNAL_ERROR',
      'UNSUPPORTED_EVENT',
      'STORE_MISMATCH',
      'RECEIPT_MISMATCH',
      'DUPLICATE_RECEIPT',
      'DUPLICATE_ID',
      'UNKNOWN_VARIANT',
      'UNKNOWN_SALE',
      'UNKNOWN_SALE_LINE',
      'SALE_VOIDED',
      'SALE_NOT_VOIDABLE',
    ]);
    expect(accepts(errorCodeSchema, 'SEQ_GAP')).toBe(true);
    expect(accepts(errorCodeSchema, 'NOPE')).toBe(false);
  });

  it('accepts the standard error shape', () => {
    expect(
      accepts(apiErrorSchema, { error: { code: 'UNAUTHORIZED', message: 'Token revoked' } }),
    ).toBe(true);
  });

  it('tolerates a code this build does not know yet', () => {
    expect(accepts(apiErrorSchema, { error: { code: 'FUTURE_CODE', message: 'x' } })).toBe(true);
  });

  it.each([{}, { error: 'nope' }, { error: { code: '', message: 'x' } }, { error: { code: 'X' } }])(
    'rejects %o',
    (body) => {
      expect(accepts(apiErrorSchema, body)).toBe(false);
    },
  );
});

describe('pushRequestSchema', () => {
  const event = (seq: number) => ({
    eventId: v7(seq),
    terminalId: ID,
    seq,
    type: 'SALE_COMPLETED',
    schemaVersion: 1,
    occurredAt: NOW,
    payload: {},
  });
  const request = (seqs: number[]) => ({ terminalId: ID, events: seqs.map(event) });
  const range = (count: number) => Array.from({ length: count }, (_, index) => index + 1);

  it('allows batches of 1 to 50', () => {
    expect(PUSH_BATCH_MAX).toBe(50);
    expect(accepts(pushRequestSchema, request([1]))).toBe(true);
    expect(accepts(pushRequestSchema, request(range(50)))).toBe(true);
  });

  it('leaves seq gaps for the server to answer with 409', () => {
    expect(accepts(pushRequestSchema, request([1, 3]))).toBe(true);
  });

  it('accepts a batch containing an invalid payload', () => {
    const body = { terminalId: ID, events: [{ ...event(1), payload: 'garbage' }] };
    expect(accepts(pushRequestSchema, body)).toBe(true);
  });

  it.each([
    ['no events', request([])],
    ['51 events', request(range(51))],
    ['descending seq', request([2, 1])],
    ['a repeated seq', request([1, 1])],
    ['a missing terminalId', { events: [event(1)] }],
    ['a broken envelope', { terminalId: ID, events: [{ seq: 1 }] }],
  ])('rejects %s', (_label, body) => {
    expect(accepts(pushRequestSchema, body)).toBe(false);
  });
});

describe('pushResponseSchema', () => {
  const result = { eventId: v7(41), seq: 41, status: 'applied', error: null };
  const response = {
    results: [result],
    lastAppliedSeq: 41,
    inventory: [{ variantId: ID, onHand: -1 }],
  };

  it('accepts the ARCH §4.4 response, with negative stock', () => {
    expect(pushResponseSchema.parse(response)).toEqual(response);
  });

  it.each(['applied', 'duplicate', 'parked', 'rejected'])('accepts status %s', (status) => {
    expect(accepts(pushResponseSchema, { ...response, results: [{ ...result, status }] })).toBe(
      true,
    );
  });

  it('accepts a rejected result with its error', () => {
    const rejected = {
      ...result,
      status: 'rejected',
      error: { code: 'OVER_RETURN', message: 'Too many returned' },
    };
    expect(accepts(pushResponseSchema, { ...response, results: [rejected] })).toBe(true);
  });

  it('accepts a terminal that has applied nothing', () => {
    expect(accepts(pushResponseSchema, { results: [], lastAppliedSeq: 0, inventory: [] })).toBe(
      true,
    );
  });

  it.each([
    ['an unknown status', { results: [{ ...result, status: 'queued' }] }],
    ['a missing error field', { results: [{ ...result, error: undefined }] }],
    ['a negative lastAppliedSeq', { lastAppliedSeq: -1 }],
    ['fractional stock', { inventory: [{ variantId: ID, onHand: 0.5 }] }],
  ])('rejects %s', (_label, change) => {
    expect(accepts(pushResponseSchema, { ...response, ...change })).toBe(false);
  });
});

describe('seqGapResponseSchema', () => {
  const body = { error: { code: 'SEQ_GAP', message: 'Expected 42' }, expectedSeq: 42 };

  it('accepts a 409 body, which is also a standard error', () => {
    expect(accepts(seqGapResponseSchema, body)).toBe(true);
    expect(accepts(apiErrorSchema, body)).toBe(true);
  });

  it.each([
    ['another code', { error: { code: 'SEQ_REUSED', message: 'x' } }],
    ['expectedSeq 0', { expectedSeq: 0 }],
    ['no expectedSeq', { expectedSeq: undefined }],
  ])('rejects %s', (_label, change) => {
    expect(accepts(seqGapResponseSchema, { ...body, ...change })).toBe(false);
  });
});

describe('pullQuerySchema', () => {
  it('accepts a first pull and a cursor', () => {
    expect(accepts(pullQuerySchema, {})).toBe(true);
    expect(accepts(pullQuerySchema, { cursor: 'opaque' })).toBe(true);
  });

  it.each([{ cursor: '' }, { cursor: 5 }, { cursor: 'x'.repeat(513) }, { cursor: ['a', 'b'] }])(
    'rejects %o',
    (query) => {
      expect(accepts(pullQuerySchema, query)).toBe(false);
    },
  );
});

describe('pullResponseSchema', () => {
  const store = {
    id: ID,
    code: 'S01',
    name: 'Demo Boutique',
    timezone: 'Australia/Sydney',
    currency: 'AUD',
    taxRateBp: 1000,
    pricesIncludeTax: true,
    cashRoundingCents: 5,
  };
  const product = {
    id: ID,
    name: 'Linen Shirt',
    brand: null,
    categoryId: null,
    description: null,
    isActive: true,
    updatedAt: NOW,
  };
  const variant = {
    id: ID,
    productId: ID,
    sku: 'LIN-BK-M',
    barcode: null,
    size: 'M',
    sizeSort: 3,
    color: 'Black',
    priceCents: 8900,
    isActive: false,
    updatedAt: NOW,
  };
  const staff = { id: ID, name: 'Demo Cashier', role: 'cashier', pinHash: 'hash', isActive: true };
  const response = {
    store,
    products: [product],
    variants: [variant],
    staff: [staff],
    inventory: [{ variantId: ID, onHand: -1 }],
    nextCursor: 'next',
    lastAppliedSeq: 0,
  };
  const pulled = (change: object) => accepts(pullResponseSchema, { ...response, ...change });

  it('accepts a full response', () => {
    expect(pullResponseSchema.parse(response)).toEqual(response);
  });

  it('accepts a response with no changes', () => {
    expect(pulled({ products: [], variants: [], staff: [], inventory: [] })).toBe(true);
  });

  it('never carries the cost price to a terminal', () => {
    const parsed = pullResponseSchema.parse({
      ...response,
      variants: [{ ...variant, costCents: 3000 }],
    });
    expect(parsed.variants[0]).not.toHaveProperty('costCents');
  });

  it.each([
    ['no store', { store: undefined }],
    ['a tax rate above 100 %', { store: { ...store, taxRateBp: 10_001 } }],
    ['a bad store code', { store: { ...store, code: 'S-01' } }],
    ['negative cash rounding', { store: { ...store, cashRoundingCents: -5 } }],
    ['a negative price', { variants: [{ ...variant, priceCents: -1 }] }],
    ['an unknown role', { staff: [{ ...staff, role: 'admin' }] }],
    ['a bad timestamp', { products: [{ ...product, updatedAt: 'now' }] }],
    ['an empty cursor', { nextCursor: '' }],
    ['no lastAppliedSeq', { lastAppliedSeq: undefined }],
  ])('rejects %s', (_label, change) => {
    expect(pulled(change)).toBe(false);
  });
});

describe('health contract (ARCH §4.7)', () => {
  it('accepts the API answer', () => {
    expect(accepts(healthResponseSchema, { status: 'ok' })).toBe(true);
  });

  it.each([{ status: 'up' }, {}, '<html>Sign in to Wi-Fi</html>', null])('rejects %o', (body) => {
    expect(accepts(healthResponseSchema, body)).toBe(false);
  });
});
