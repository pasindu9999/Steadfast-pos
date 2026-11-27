import { describe, expect, it } from 'vitest';

import { ApiRequestError } from '../sync/api-client';
import { EnrolmentError } from '../sync/enrol-terminal';
import { enrolmentMessage } from './enrolment-message';

describe('enrolmentMessage', () => {
  it.each([
    [new EnrolmentError('INVALID_URL'), /server address/i],
    [new EnrolmentError('INVALID_CODE'), /at least 8 characters/i],
    [new EnrolmentError('ALREADY_ENROLLED'), /already set up/i],
    [new ApiRequestError('network'), /can't reach the server/i],
    [new ApiRequestError('http', 401, 'INVALID_ENROLMENT_CODE'), /code is not valid/i],
    [new ApiRequestError('http', 401, 'UNAUTHORIZED'), /no longer accepts/i],
    [new ApiRequestError('http', 429, 'RATE_LIMITED'), /wait a minute/i],
    [new ApiRequestError('http', 500, 'INTERNAL_ERROR'), /server had a problem/i],
    [new ApiRequestError('invalid_response', 200), /unexpected reply/i],
  ])('explains %o', (error, expected) => {
    expect(enrolmentMessage(error)).toMatch(expected);
  });

  it('never shows a raw error to staff', () => {
    expect(enrolmentMessage(new Error('QuotaExceededError: idb'))).toBe(
      'Something went wrong. Try again.',
    );
  });
});
