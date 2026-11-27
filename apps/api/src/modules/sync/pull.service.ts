import { Injectable } from '@nestjs/common';
import { type PullResponse, type StaffRole } from '@pos/core';

import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { AuthenticatedTerminal } from '../terminals/device-auth.guard.js';
import { decodeCursor, encodeCursor } from './pull-cursor.js';

// Longer than any writing transaction may run, so a row that commits late is still picked up
// (ARCH §4.6).
const OVERLAP_MS = 60_000;

@Injectable()
export class PullService {
  constructor(private readonly prisma: PrismaService) {}

  async pull(terminal: AuthenticatedTerminal, cursor?: string): Promise<PullResponse> {
    const changed =
      cursor === undefined
        ? {}
        : { updatedAt: { gte: new Date(decodeCursor(cursor).getTime() - OVERLAP_MS) } };

    // One snapshot, so stock and `lastAppliedSeq` agree: the terminal drops its local deltas up to
    // that seq when it takes these levels (ARCH §4.6).
    return this.prisma.$transaction(
      async (tx) => {
        // Raw SQL: the cursor must come from the clock that stamps `updated_at` (ARCH §4.6).
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT now() AS "now"`;
        const store = await tx.store.findUniqueOrThrow({
          where: { id: terminal.storeId },
          omit: { createdAt: true },
        });
        const products = await tx.product.findMany({ where: changed, omit: { createdAt: true } });
        const variants = await tx.productVariant.findMany({
          where: changed,
          omit: { costCents: true },
        });
        const staff = await tx.staff.findMany({
          where: { storeId: terminal.storeId },
          omit: { storeId: true },
        });
        const inventory = await tx.inventoryLevel.findMany({
          where: { storeId: terminal.storeId, ...changed },
          select: { variantId: true, onHand: true },
        });
        const { lastAppliedSeq } = await tx.terminal.findUniqueOrThrow({
          where: { id: terminal.id },
          select: { lastAppliedSeq: true },
        });

        const stamped = <T extends { updatedAt: Date }>(row: T) => ({
          ...row,
          updatedAt: row.updatedAt.toISOString(),
        });
        return {
          store,
          products: products.map(stamped),
          variants: variants.map(stamped),
          staff: staff.map((member) => ({ ...member, role: member.role as StaffRole })),
          inventory,
          nextCursor: encodeCursor(clock!.now),
          lastAppliedSeq: Number(lastAppliedSeq),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
