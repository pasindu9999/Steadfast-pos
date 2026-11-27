import { describe, expect, it } from 'vitest';

import { ApiRequestError } from './api-client';
import { classifyFailure } from './classify-failure';

describe('classifyFailure', () => {
  it.each([
    [401, 'UNAUTHORIZED', 'UNAUTHORIZED'],
    // A proxy may strip the body: the status is enough.
    [401, null, 'UNAUTHORIZED'],
    [403, 'TERMINAL_MISMATCH', 'TERMINAL_MISMATCH'],
  ])('halts on %i %s', (status, code, reason) => {
    expect(classifyFailure(new ApiRequestError('http', status, code))).toEqual({
      kind: 'halt',
      reason,
    });
  });

  it.each([
    ['a network failure or timeout', new ApiRequestError('network')],
    ['an unreadable response', new ApiRequestError('invalid_response', 200)],
    ['a server error', new ApiRequestError('http', 500, 'INTERNAL_ERROR')],
    ['a gateway error', new ApiRequestError('http', 502)],
    ['rate limiting', new ApiRequestError('http', 429, 'RATE_LIMITED')],
    ['a refused request', new ApiRequestError('http', 400, 'VALIDATION_FAILED')],
    ['an unexplained 403', new ApiRequestError('http', 403)],
    ['anything else', new Error('database closed')],
  ])('retries after %s', (_, error) => {
    expect(classifyFailure(error)).toEqual({ kind: 'retry' });
  });
});
