import type { Prisma } from '../../../generated/prisma/client.js';

export interface LockedSale {
  receiptNo: string;
  storeId: string;
  terminalId: string;
  status: 'completed' | 'voided';
}

export async function lockSaleId(tx: Prisma.TransactionClient, saleId: string): Promise<void> {
  // Raw SQL: there is no row to lock while the sale is uncommitted. Without this, a return could
  // park just after its sale looked for parked returns, and stay parked (ARCH §4.4 step 7).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${saleId}, 0))`;
}

export async function lockSale(
  tx: Prisma.TransactionClient,
  saleId: string,
): Promise<LockedSale | null> {
  await lockSaleId(tx, saleId);
  // Raw SQL: Prisma cannot lock a row. Σ returned ≤ sold is checked while it is held (ARCH §5.4).
  const [sale] = await tx.$queryRaw<LockedSale[]>`
    SELECT receipt_no AS "receiptNo", store_id AS "storeId", terminal_id AS "terminalId", status
    FROM sales WHERE id = ${saleId}::uuid FOR UPDATE`;
  return sale ?? null;
}
