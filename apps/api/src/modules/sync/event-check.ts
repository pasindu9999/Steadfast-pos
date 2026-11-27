import {
  type ErrorCode,
  EVENT_TYPES,
  type EventEnvelope,
  parseReceiptNo,
  parseReturnNo,
  SCHEMA_VERSION,
  type SyncEvent,
  syncEventSchema,
} from '@pos/core';

import { describeIssue } from '../../common/zod-validation.pipe.js';
import type { AuthenticatedTerminal } from '../terminals/device-auth.guard.js';
import { toStorable } from './storable.js';

export interface Rejection {
  code: ErrorCode;
  message: string;
}

export interface CheckedEvent {
  eventId: string;
  seq: number;
  record: { type: string; payload: unknown; occurredAt: Date };
  printed: { receiptSeq: number; returnSeq: number };
  verdict: { ok: true; event: SyncEvent } | { ok: false; rejection: Rejection };
}

function printedSeq(value: unknown, parse: typeof parseReceiptNo, terminal: AuthenticatedTerminal) {
  const parts = typeof value === 'string' ? parse(value) : null;
  const own = parts?.storeCode === terminal.storeCode && parts.terminalCode === terminal.code;
  return own ? parts.seq : 0;
}

export function refuse(
  event: Omit<CheckedEvent, 'verdict'>,
  code: ErrorCode,
  message: string,
): CheckedEvent {
  return { ...event, verdict: { ok: false, rejection: { code, message } } };
}

export function checkEvent(envelope: EventEnvelope, terminal: AuthenticatedTerminal): CheckedEvent {
  const { eventId, seq, type } = envelope;
  const payload = toStorable(envelope.payload ?? null);
  const storedType = toStorable(type);
  const hasStorableTime = !envelope.occurredAt.startsWith('0000');
  const numbers = (payload.value ?? {}) as { receiptNo?: unknown; returnNo?: unknown };

  const checked = {
    eventId,
    seq,
    record: {
      type: storedType.value as string,
      payload: payload.value,
      occurredAt: hasStorableTime ? new Date(envelope.occurredAt) : new Date(),
    },
    printed: {
      receiptSeq: printedSeq(numbers.receiptNo, parseReceiptNo, terminal),
      returnSeq: printedSeq(numbers.returnNo, parseReturnNo, terminal),
    },
  };
  const reject = (code: ErrorCode, message: string) => refuse(checked, code, message);

  if (envelope.terminalId !== terminal.id) {
    return reject('TERMINAL_MISMATCH', 'The event belongs to another terminal');
  }
  const knownType = (EVENT_TYPES as readonly string[]).includes(type);
  if (!knownType || envelope.schemaVersion !== SCHEMA_VERSION) {
    return reject('UNSUPPORTED_EVENT', 'The server does not support this event type or version');
  }
  if (payload.changed || !hasStorableTime) {
    return reject('INVALID_PAYLOAD', 'The event holds a value the database cannot store');
  }
  const parsed = syncEventSchema.safeParse(envelope);
  if (!parsed.success) return reject('INVALID_PAYLOAD', describeIssue(parsed.error));

  return {
    ...checked,
    record: { ...checked.record, payload: parsed.data.payload },
    verdict: { ok: true, event: parsed.data },
  };
}
