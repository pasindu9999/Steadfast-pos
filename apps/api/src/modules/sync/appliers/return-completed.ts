import { parseReturnNo, type ReturnCompletedPayload } from '@pos/core';

import type { Prisma } from '../../../generated/prisma/client.js';
import { type ApplyContext, type ApplyOutcome, rejected } from './applier.js';
import { checkOrigin, resolveStaff } from './checks.js';
import { lockSale } from './sale-lock.js';

async function findDuplicate(
  tx: Prisma.TransactionClient,
  returned: ReturnCompletedPayload,
): Promise<ApplyOutcome | null> {
  if ((await tx.saleReturn.count({ where: { returnNo: returned.returnNo } })) > 0) {
    return rejected('DUPLICATE_RECEIPT', 'The return number is already used');
  }
  const lineIds = returned.lines.map((line) => line.returnLineId);
  const refundIds = returned.refunds.map((refund) => refund.refundId);
  const reused =
    (await tx.saleReturn.count({ where: { id: returned.returnId } })) +
    (await tx.returnLine.count({ where: { id: { in: lineIds } } })) +
    (await tx.refund.count({ where: { id: { in: refundIds } } }));
  return reused > 0 ? rejected('DUPLICATE_ID', 'An id in the return is already used') : null;
}

export async function applyReturnCompleted(
  { tx, terminal, occurredAt, stock }: ApplyContext,
  returned: ReturnCompletedPayload,
): Promise<ApplyOutcome> {
  const { returnId, originalSaleId, storeId } = returned;

  const wrongOrigin = checkOrigin(terminal, storeId, parseReturnNo(returned.returnNo));
  if (wrongOrigin) return wrongOrigin;
  const sale = await lockSale(tx, originalSaleId);
  const duplicate = await findDuplicate(tx, returned);
  if (duplicate) return duplicate;
  if (!sale) return { status: 'parked' };
  if (sale.status === 'voided') return rejected('SALE_VOIDED', 'The sale was voided');

  const sold = await tx.saleLine.findMany({
    where: { saleId: originalSaleId },
    include: { returnLines: { select: { qty: true } } },
  });
  const soldByLineNo = new Map(sold.map((line) => [line.lineNo, line]));
  const lines = [];
  const restocked = [];
  for (const { returnLineId, saleLineNo, variantId, qty, ...line } of returned.lines) {
    const saleLine = soldByLineNo.get(saleLineNo);
    if (!saleLine) return rejected('UNKNOWN_SALE_LINE', `The sale has no line ${saleLineNo}`);
    if (saleLine.variantId !== variantId) {
      return rejected('INVALID_PAYLOAD', `Line ${saleLineNo} sold a different variant`);
    }
    const alreadyReturned = saleLine.returnLines.reduce((total, entry) => total + entry.qty, 0);
    if (alreadyReturned + qty > saleLine.qty) {
      return rejected('OVER_RETURN', `Line ${saleLineNo} has fewer units left to return`);
    }
    lines.push({ id: returnLineId, returnId, saleLineId: saleLine.id, qty, ...line });
    if (line.restock) restocked.push({ variantId, delta: qty });
  }

  const { staffId } = await resolveStaff(tx, storeId, returned.staffId);
  await tx.saleReturn.create({
    data: {
      id: returnId,
      returnNo: returned.returnNo,
      originalSaleId,
      storeId,
      terminalId: terminal.id,
      staffId,
      reason: returned.reason,
      refundTotalCents: returned.refundTotalCents,
      roundingCents: returned.roundingCents,
      occurredAt,
    },
  });
  await tx.returnLine.createMany({ data: lines });
  await tx.refund.createMany({
    data: returned.refunds.map(({ refundId, ...refund }) => ({
      id: refundId,
      returnId,
      ...refund,
    })),
  });
  await stock.record(
    tx,
    storeId,
    {
      reason: 'return',
      sourceType: 'return',
      sourceId: returnId,
      terminalId: terminal.id,
      staffId,
      occurredAt,
    },
    restocked,
  );
  return { status: 'applied' };
}
