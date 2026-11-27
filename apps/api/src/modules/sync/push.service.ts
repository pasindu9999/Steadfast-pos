import { Injectable, Logger } from '@nestjs/common';
import type { PushRequest, PushResponse, PushResult } from '@pos/core';

import { ApiException } from '../../common/api-exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { AuthenticatedTerminal } from '../terminals/device-auth.guard.js';
import { type ApplyOutcome, rejected } from './appliers/applier.js';
import { applyEvent } from './appliers/apply-event.js';
import { type CheckedEvent, checkEvent, refuse } from './event-check.js';
import { isOutOfRange } from './out-of-range.js';
import { retryOnDeadlock } from './retry-deadlock.js';

const TRANSACTION = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 5_000,
  timeout: 15_000,
};

type Decision = ApplyOutcome | { status: 'duplicate' };

interface TerminalCounters {
  lastAppliedSeq: bigint;
  receiptSeq: bigint;
  returnSeq: bigint;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(private readonly prisma: PrismaService) {}

  async push(terminal: AuthenticatedTerminal, request: PushRequest): Promise<PushResponse> {
    const events = request.events.map((envelope) => checkEvent(envelope, terminal));

    const results: PushResult[] = [];
    for (const event of events) {
      results.push(await this.pushEvent(terminal, event));
    }

    const { lastAppliedSeq } = await this.prisma.terminal.findUniqueOrThrow({
      where: { id: terminal.id },
      select: { lastAppliedSeq: true },
    });
    return {
      results,
      lastAppliedSeq: Number(lastAppliedSeq),
      inventory: await this.levelsTouchedBy(terminal, events),
    };
  }

  private async pushEvent(
    terminal: AuthenticatedTerminal,
    event: CheckedEvent,
  ): Promise<PushResult> {
    const { eventId, seq } = event;
    // One transaction per event, so a later failure keeps the earlier ones. It is run again if it
    // loses a deadlock (ARCH §4.4).
    const run = (checked: CheckedEvent) =>
      retryOnDeadlock(() =>
        this.prisma.$transaction((tx) => this.decide(tx, terminal, checked), TRANSACTION),
      );
    // An event whose effect can never be stored is refused, or it would block the queue for good
    // (ARCH §4.4 step 5).
    const decision = await run(event).catch((failure: unknown) => {
      if (!isOutOfRange(failure)) throw failure;
      return run(refuse(event, 'INVALID_PAYLOAD', 'A quantity is too large to store'));
    });

    const error =
      decision.status === 'rejected' ? { code: decision.code, message: decision.message } : null;
    this.log({ eventId, terminalId: terminal.id, seq, status: decision.status, code: error?.code });
    if (decision.status === 'applied') {
      for (const parked of decision.released ?? []) this.log(parked);
    }
    return { eventId, seq, status: decision.status, error };
  }

  private async decide(
    tx: Prisma.TransactionClient,
    terminal: AuthenticatedTerminal,
    event: CheckedEvent,
  ): Promise<Decision> {
    const { eventId, seq } = event;
    const counters = await lockTerminal(tx, terminal.id);

    const known = await tx.syncInbox.findUnique({ where: { eventId }, select: { seq: true } });
    if (known) return { status: 'duplicate' };

    const expectedSeq = Number(counters.lastAppliedSeq) + 1;
    if (seq < expectedSeq) {
      return rejected('SEQ_REUSED', 'This seq was already used: enrol the terminal again');
    }
    if (seq > expectedSeq) {
      this.log({ eventId, terminalId: terminal.id, seq, status: 'refused', code: 'SEQ_GAP' });
      throw new ApiException(409, 'SEQ_GAP', `Expected seq ${expectedSeq}`, { expectedSeq });
    }

    const outcome: ApplyOutcome = event.verdict.ok
      ? await applyEvent(tx, terminal, event.verdict.event)
      : { status: 'rejected', ...event.verdict.rejection };
    await recordEvent(tx, terminal.id, event, outcome);
    await advanceTerminal(tx, terminal.id, counters, event);
    return outcome;
  }

  private log(decision: {
    eventId: string;
    terminalId: string;
    seq: number;
    status: string;
    code?: string;
  }) {
    this.logger.log({ msg: 'sync event', ...decision });
  }

  private async levelsTouchedBy(terminal: AuthenticatedTerminal, events: CheckedEvent[]) {
    const variantIds = new Set<string>();
    const voidedSaleIds: string[] = [];
    for (const { verdict } of events) {
      if (!verdict.ok) continue;
      const { event } = verdict;
      if (event.type === 'SALE_VOIDED') voidedSaleIds.push(event.payload.saleId);
      else for (const line of event.payload.lines) variantIds.add(line.variantId);
    }
    if (voidedSaleIds.length > 0) {
      const lines = await this.prisma.saleLine.findMany({
        where: { saleId: { in: voidedSaleIds } },
        select: { variantId: true },
      });
      for (const line of lines) variantIds.add(line.variantId);
    }
    return this.prisma.inventoryLevel.findMany({
      where: { storeId: terminal.storeId, variantId: { in: [...variantIds] } },
      select: { variantId: true, onHand: true },
      orderBy: { variantId: 'asc' },
    });
  }
}

async function lockTerminal(
  tx: Prisma.TransactionClient,
  terminalId: string,
): Promise<TerminalCounters> {
  // Raw SQL: Prisma cannot lock a row. A retry that overlaps a slow request waits here, then finds
  // the event already committed (ARCH §4.4 step 1).
  const [counters] = await tx.$queryRaw<TerminalCounters[]>`
    SELECT last_applied_seq AS "lastAppliedSeq",
           receipt_seq AS "receiptSeq",
           return_seq AS "returnSeq"
    FROM terminals WHERE id = ${terminalId}::uuid FOR UPDATE`;
  if (!counters) throw new Error(`no terminal ${terminalId} to lock`);
  return counters;
}

async function recordEvent(
  tx: Prisma.TransactionClient,
  terminalId: string,
  { eventId, seq, record }: CheckedEvent,
  outcome: ApplyOutcome,
) {
  await tx.syncInbox.create({
    data: {
      eventId,
      terminalId,
      seq,
      type: record.type,
      status: outcome.status,
      payload: record.payload ?? Prisma.JsonNull,
      error: outcome.status === 'rejected' ? `${outcome.code}: ${outcome.message}` : null,
      occurredAt: record.occurredAt,
      appliedAt: outcome.status === 'applied' ? new Date() : null,
    },
  });
}

async function advanceTerminal(
  tx: Prisma.TransactionClient,
  terminalId: string,
  counters: TerminalCounters,
  { seq, printed }: CheckedEvent,
) {
  const larger = (current: bigint, seen: number) =>
    BigInt(seen) > current ? BigInt(seen) : current;
  await tx.terminal.update({
    where: { id: terminalId },
    data: {
      lastAppliedSeq: seq,
      receiptSeq: larger(counters.receiptSeq, printed.receiptSeq),
      returnSeq: larger(counters.returnSeq, printed.returnSeq),
      lastSeenAt: new Date(),
    },
  });
}
