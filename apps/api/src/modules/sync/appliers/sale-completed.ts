import { parseReceiptNo, type SaleCompletedPayload } from '@pos/core';

import { Prisma } from '../../../generated/prisma/client.js';
import { saleFlags } from '../sale-flags.js';
import { type ApplyContext, type ApplyOutcome, rejected } from './applier.js';
import { checkOrigin, resolveStaff } from './checks.js';
import { applyParkedReturns } from './parked-returns.js';
import { lockSaleId } from './sale-lock.js';

async function findDuplicate(
  tx: Prisma.TransactionClient,
  sale: SaleCompletedPayload,
): Promise<ApplyOutcome | null> {
  if ((await tx.sale.count({ where: { receiptNo: sale.receiptNo } })) > 0) {
    return rejected('DUPLICATE_RECEIPT', 'The receipt number is already used');
  }
  const reused =
    (await tx.sale.count({ where: { id: sale.saleId } })) +
    (await tx.saleLine.count({ where: { id: { in: sale.lines.map((line) => line.lineId) } } })) +
    (await tx.payment.count({
      where: { id: { in: sale.payments.map((payment) => payment.paymentId) } },
    }));
  return reused > 0 ? rejected('DUPLICATE_ID', 'An id in the sale is already used') : null;
}

export async function applySaleCompleted(
  context: ApplyContext,
  sale: SaleCompletedPayload,
): Promise<ApplyOutcome> {
  const { tx, terminal, occurredAt, stock } = context;
  const { saleId, storeId } = sale;

  const wrongOrigin = checkOrigin(terminal, storeId, parseReceiptNo(sale.receiptNo));
  if (wrongOrigin) return wrongOrigin;
  await lockSaleId(tx, saleId);
  const duplicate = await findDuplicate(tx, sale);
  if (duplicate) return duplicate;

  const variantIds = new Set(sale.lines.map((line) => line.variantId));
  const variants = await tx.productVariant.findMany({
    where: { id: { in: [...variantIds] } },
    select: { id: true, priceCents: true },
  });
  if (variants.length < variantIds.size) {
    return rejected('UNKNOWN_VARIANT', 'The sale has a variant the server does not know');
  }

  const staff = await resolveStaff(tx, storeId, sale.staffId);
  const store = await tx.store.findUniqueOrThrow({ where: { id: storeId } });
  const flags = saleFlags({
    payload: sale,
    store: { ...store, storeId },
    currentPrices: new Map(variants.map((variant) => [variant.id, variant.priceCents])),
    occurredAt,
    receivedAt: new Date(),
    staffKnown: staff.known,
  });

  await tx.sale.create({
    data: {
      id: saleId,
      receiptNo: sale.receiptNo,
      storeId,
      terminalId: terminal.id,
      staffId: staff.staffId,
      status: 'completed',
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      taxCents: sale.taxCents,
      roundingCents: sale.roundingCents,
      totalCents: sale.totalCents,
      cartDiscount: sale.cartDiscount ?? Prisma.DbNull,
      occurredAt,
      flags,
    },
  });
  await tx.saleLine.createMany({
    data: sale.lines.map((line) => ({
      id: line.lineId,
      saleId,
      lineNo: line.lineNo,
      variantId: line.variantId,
      skuSnapshot: line.skuSnapshot,
      nameSnapshot: line.nameSnapshot,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      lineDiscountCents: line.lineDiscountCents,
      taxCents: line.taxCents,
      lineTotalCents: line.lineTotalCents,
    })),
  });
  await tx.payment.createMany({
    data: sale.payments.map(({ paymentId, ...payment }) => ({
      id: paymentId,
      saleId,
      ...payment,
    })),
  });
  await stock.record(
    tx,
    storeId,
    {
      reason: 'sale',
      sourceType: 'sale',
      sourceId: saleId,
      terminalId: terminal.id,
      staffId: staff.staffId,
      occurredAt,
    },
    sale.lines.map((line) => ({ variantId: line.variantId, delta: -line.qty })),
  );

  return { status: 'applied', released: await applyParkedReturns(context, saleId) };
}
