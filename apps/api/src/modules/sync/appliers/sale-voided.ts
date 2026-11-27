import type { SaleVoidedPayload } from '@pos/core';

import { type ApplyContext, type ApplyOutcome, rejected } from './applier.js';
import { resolveStaff } from './checks.js';
import { lockSale } from './sale-lock.js';

export async function applySaleVoided(
  { tx, terminal, occurredAt, stock }: ApplyContext,
  { saleId, receiptNo, staffId, reason }: SaleVoidedPayload,
): Promise<ApplyOutcome> {
  const sale = await lockSale(tx, saleId);
  if (!sale) return rejected('UNKNOWN_SALE', 'The server does not have this sale');
  if (sale.terminalId !== terminal.id) {
    return rejected('SALE_NOT_VOIDABLE', 'The sale was made on another terminal');
  }
  if (sale.receiptNo !== receiptNo) {
    return rejected('RECEIPT_MISMATCH', 'The receipt number belongs to another sale');
  }
  if (sale.status === 'voided') return rejected('SALE_VOIDED', 'The sale was already voided');
  if ((await tx.saleReturn.count({ where: { originalSaleId: saleId } })) > 0) {
    return rejected('SALE_NOT_VOIDABLE', 'The sale already has returns');
  }

  const staff = await resolveStaff(tx, sale.storeId, staffId);
  await tx.sale.update({
    where: { id: saleId },
    data: { status: 'voided', voidedAt: occurredAt, voidReason: reason },
  });
  const lines = await tx.saleLine.findMany({
    where: { saleId },
    select: { variantId: true, qty: true },
  });
  await stock.record(
    tx,
    sale.storeId,
    {
      reason: 'void',
      sourceType: 'sale',
      sourceId: saleId,
      terminalId: terminal.id,
      staffId: staff.staffId,
      occurredAt,
    },
    lines.map(({ variantId, qty }) => ({ variantId, delta: qty })),
  );
  return { status: 'applied' };
}
