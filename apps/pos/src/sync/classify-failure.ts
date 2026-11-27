import type { HaltReason } from '../db/types';
import { ApiRequestError } from './api-client';

/** `halt`: trying again cannot help. `retry`: try again later, backing off (ARCH §4.7). */
export type FailureAction = { kind: 'halt'; reason: HaltReason } | { kind: 'retry' };

export function classifyFailure(error: unknown): FailureAction {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return { kind: 'halt', reason: 'UNAUTHORIZED' };
    if (error.status === 403 && error.code === 'TERMINAL_MISMATCH') {
      return { kind: 'halt', reason: 'TERMINAL_MISMATCH' };
    }
  }
  return { kind: 'retry' };
}
