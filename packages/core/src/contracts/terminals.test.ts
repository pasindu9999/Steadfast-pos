import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  enrolRequestSchema,
  enrolResponseSchema,
  type EnrolRequest,
  type EnrolResponse,
} from './terminals.js';

const response = {
  terminalId: '33333333-3333-4333-8333-333333333333',
  terminalCode: 'T2',
  deviceToken: 'k'.repeat(43),
  lastAppliedSeq: 0,
  receiptSeq: 123,
  returnSeq: 17,
};

describe('enrolRequestSchema', () => {
  it('trims the typed code', () => {
    expect(enrolRequestSchema.parse({ enrolmentCode: '  DEMO-S01-T1 ' })).toEqual({
      enrolmentCode: 'DEMO-S01-T1',
    });
    expectTypeOf<EnrolRequest>().toEqualTypeOf<{ enrolmentCode: string }>();
  });

  it.each([
    {},
    { enrolmentCode: 12345678 },
    { enrolmentCode: 'short' },
    { enrolmentCode: '        ' },
    { enrolmentCode: 'x'.repeat(65) },
  ])('rejects %o', (value) => {
    expect(enrolRequestSchema.safeParse(value).success).toBe(false);
  });
});

describe('enrolResponseSchema', () => {
  it('accepts the token and the counter high-water marks (ARCH §4.3)', () => {
    expect(enrolResponseSchema.parse(response)).toEqual(response);
    expectTypeOf<EnrolResponse>().toHaveProperty('lastAppliedSeq').toEqualTypeOf<number>();
  });

  it.each([
    { terminalId: 'T2' },
    { terminalCode: 'till 2' },
    { deviceToken: '' },
    { lastAppliedSeq: -1 },
    { receiptSeq: 1.5 },
    { returnSeq: undefined },
  ])('rejects %o', (override) => {
    expect(enrolResponseSchema.safeParse({ ...response, ...override }).success).toBe(false);
  });
});
