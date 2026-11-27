import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('@pos/core', () => {
  it.each([
    'formatAUD',
    'roundCash5c',
    'calculateTax',
    'allocateProRata',
    'calculateCart',
    'refundForLines',
    'applyRefundRounding',
    'formatReceiptNo',
    'parseReturnNo',
    'syncEventSchema',
    'eventEnvelopeSchema',
    'pushRequestSchema',
    'pullResponseSchema',
    'apiErrorSchema',
  ])('exports %s from the package root', (name) => {
    expect(core).toHaveProperty(name);
  });
});
