import type { EnrolResponse } from '@pos/core';
import { vi } from 'vitest';

export const TERMINAL_ID = '22222222-2222-4222-8222-222222222222';
export const DEVICE_TOKEN = 'device-token-'.padEnd(43, 'x');

export const enrolFixture: EnrolResponse = {
  terminalId: TERMINAL_ID,
  terminalCode: 'T1',
  deviceToken: DEVICE_TOKEN,
  lastAppliedSeq: 0,
  receiptSeq: 0,
  returnSeq: 0,
};

/** A `fetch` that answers every request with the same status and body. */
export function fakeFetch(status: number, body: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(text, { status })));
}
