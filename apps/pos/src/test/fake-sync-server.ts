/**
 * The sync API as the terminal sees it, served by MSW. It follows the real server's rules
 * (ARCH §4.4, §4.6): inbox, sequence checks, 409, stock deltas, with failures injected by tests.
 */
import { type PushResult, pushRequestSchema, type SyncEvent, syncEventSchema } from '@pos/core';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { pullFixture } from './fixtures';

export const API_URL = 'https://api.test';

/** One injected failure, used up by the next push request. */
export type PushFault =
  /** The server commits every event, then the connection drops. */
  | 'drop_after_commit'
  /** The connection drops before the server sees anything. */
  | 'drop_before_commit'
  | 'unauthorized'
  | 'server_error';

interface InboxRow {
  seq: number;
  status: PushResult['status'];
  error: PushResult['error'];
}

const apiError = (status: number, code: string, extra: object = {}) =>
  HttpResponse.json({ error: { code, message: code }, ...extra }, { status });

export function createFakeSyncServer() {
  const server = setupServer();

  const state = {
    lastAppliedSeq: 0,
    inbox: new Map<string, InboxRow>(),
    /** Events whose effects were stored, in the order they were applied. */
    applied: [] as SyncEvent[],
    stock: new Map<string, number>(),
    /** The seqs of every push request that arrived. */
    pushes: [] as number[][],
    /** The raw events of every push request. */
    sentEvents: [] as unknown[],
    pulls: 0,
    healthChecks: 0,
    healthy: true,
    /** Every request that arrived, in order. */
    log: [] as ('health' | 'push' | 'pull')[],
    faults: [] as PushFault[],
    /** The same for pull requests. */
    pullFaults: [] as ('unauthorized' | 'server_error')[],
    /** Rejection codes by seq. */
    rejections: new Map<number, string>(),
    /** Seqs answered `parked`. */
    parks: new Set<number>(),
    inFlight: 0,
    maxInFlight: 0,
    /** Runs while a push is in flight, before the server looks at it. */
    onPush: undefined as undefined | ((seqs: number[]) => Promise<void> | void),
    /** Runs while a pull is in flight. */
    onPull: undefined as undefined | (() => Promise<void> | void),
  };

  function levels(variantIds: Iterable<string>) {
    return [...new Set(variantIds)].flatMap((variantId) => {
      const onHand = state.stock.get(variantId);
      return onHand === undefined ? [] : [{ variantId, onHand }];
    });
  }

  /** What an event does to stock (ARCH §4.1). A void puts back the sale applied before it. */
  function stockChanges(event: SyncEvent): { variantId: string; delta: number }[] {
    switch (event.type) {
      case 'SALE_COMPLETED':
        return event.payload.lines.map(({ variantId, qty }) => ({ variantId, delta: -qty }));
      case 'RETURN_COMPLETED':
        return event.payload.lines.map(({ variantId, qty, restock }) => ({
          variantId,
          delta: restock ? qty : 0,
        }));
      case 'SALE_VOIDED': {
        const sale = state.applied.find(
          (applied) =>
            applied.type === 'SALE_COMPLETED' && applied.payload.saleId === event.payload.saleId,
        );
        return sale?.type === 'SALE_COMPLETED'
          ? sale.payload.lines.map(({ variantId, qty }) => ({ variantId, delta: qty }))
          : [];
      }
      default: {
        const unhandled: never = event;
        return unhandled;
      }
    }
  }

  function apply(event: SyncEvent) {
    for (const { variantId, delta } of stockChanges(event)) {
      state.stock.set(variantId, (state.stock.get(variantId) ?? 0) + delta);
    }
    state.applied.push(event);
  }

  const handlers = [
    http.get(`${API_URL}/v1/health`, () => {
      state.log.push('health');
      state.healthChecks += 1;
      return state.healthy ? HttpResponse.json({ status: 'ok' }) : HttpResponse.error();
    }),

    http.post(`${API_URL}/v1/sync/push`, async ({ request }) => {
      const body: unknown = await request.json();
      const parsed = pushRequestSchema.safeParse(body);
      if (!parsed.success) return apiError(400, 'VALIDATION_FAILED');
      const { events } = parsed.data;
      const seqs = events.map((event) => event.seq);
      state.log.push('push');
      state.pushes.push(seqs);
      state.sentEvents.push(...(body as { events: unknown[] }).events);

      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        await state.onPush?.(seqs);

        const fault = state.faults.shift();
        if (fault === 'drop_before_commit') return HttpResponse.error();
        if (fault === 'unauthorized') return apiError(401, 'UNAUTHORIZED');
        if (fault === 'server_error') return apiError(500, 'INTERNAL_ERROR');

        const results: PushResult[] = [];
        const touched: string[] = [];
        for (const envelope of events) {
          const { eventId, seq } = envelope;
          const event = syncEventSchema.safeParse(envelope);
          if (event.success) {
            touched.push(...stockChanges(event.data).map((change) => change.variantId));
          }
          const known = state.inbox.get(eventId);
          if (known) {
            const status = known.status === 'rejected' ? 'rejected' : 'duplicate';
            results.push({ eventId, seq, status, error: known.error });
            continue;
          }
          const expectedSeq = state.lastAppliedSeq + 1;
          if (seq < expectedSeq) {
            const error = { code: 'SEQ_REUSED', message: 'SEQ_REUSED' };
            results.push({ eventId, seq, status: 'rejected', error });
            continue;
          }
          if (seq > expectedSeq) return apiError(409, 'SEQ_GAP', { expectedSeq });

          const code = state.rejections.get(seq) ?? (event.success ? null : 'INVALID_PAYLOAD');
          const status = code ? 'rejected' : state.parks.has(seq) ? 'parked' : 'applied';
          const error = code ? { code, message: code } : null;
          if (status === 'applied' && event.success) apply(event.data);
          state.inbox.set(eventId, { seq, status, error });
          state.lastAppliedSeq = seq;
          results.push({ eventId, seq, status, error });
        }

        if (fault === 'drop_after_commit') return HttpResponse.error();
        return HttpResponse.json({
          results,
          lastAppliedSeq: state.lastAppliedSeq,
          inventory: levels(touched),
        });
      } finally {
        state.inFlight -= 1;
      }
    }),

    http.get(`${API_URL}/v1/sync/pull`, async () => {
      state.log.push('pull');
      state.pulls += 1;
      const fault = state.pullFaults.shift();
      if (fault === 'unauthorized') return apiError(401, 'UNAUTHORIZED');
      if (fault === 'server_error') return apiError(500, 'INTERNAL_ERROR');
      // The answer describes the moment the request arrived.
      const response = pullFixture({
        inventory: levels(state.stock.keys()),
        lastAppliedSeq: state.lastAppliedSeq,
        nextCursor: `cursor-${state.pulls + 1}`,
      });
      await state.onPull?.();
      return HttpResponse.json(response);
    }),
  ];

  return {
    state,
    msw: server,
    listen() {
      server.use(...handlers);
      server.listen({ onUnhandledFrame: 'error' });
    },
    close: () => server.close(),
  };
}

export type FakeSyncServer = ReturnType<typeof createFakeSyncServer>;
