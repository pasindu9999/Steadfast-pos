import { apiErrorSchema, pushResponseSchema, seqGapResponseSchema } from '@pos/core';
import { expect } from 'vitest';

import type { TestApp } from './app.js';
import type { TestTerminal } from './shop.js';

export function push(app: TestApp, terminal: TestTerminal, events: readonly unknown[]) {
  return app.request('/v1/sync/push', {
    token: terminal.token,
    json: { terminalId: terminal.id, events },
  });
}

/** Pushes and expects a 200 that matches the contract. */
export async function pushOk(app: TestApp, terminal: TestTerminal, events: readonly unknown[]) {
  const response = await push(app, terminal, events);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return pushResponseSchema.parse(response.body);
}

/** `applied`, `duplicate`, `parked`, or `rejected:CODE`, one per event. */
export async function pushOutcomes(
  app: TestApp,
  terminal: TestTerminal,
  events: readonly unknown[],
) {
  const { results } = await pushOk(app, terminal, events);
  return results.map(({ status, error }) => (error ? `${status}:${error.code}` : status));
}

export const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;

export const expectedSeqOf = (body: unknown) => seqGapResponseSchema.parse(body).expectedSeq;
