import { Injectable } from '@nestjs/common';
import type { ReceiptLookupResponse, SaleStatus, TenderMethod } from '@pos/core';

import { ApiException } from '../../common/api-exception.js';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Only the terminal's own store (ARCH §10.1). */
  async lookUp(storeId: string, receiptNo: string): Promise<ReceiptLookupResponse> {
    const sale = await this.prisma.sale.findFirst({
      where: { receiptNo, storeId },
      include: {
        lines: {
          orderBy: { lineNo: 'asc' },
          include: { returnLines: { select: { qty: true } } },
        },
        payments: { orderBy: { id: 'asc' }, omit: { id: true, saleId: true } },
      },
    });
    if (!sale) throw new ApiException(404, 'NOT_FOUND', 'No sale has that receipt number');

    return {
      saleId: sale.id,
      receiptNo: sale.receiptNo,
      storeId: sale.storeId,
      terminalId: sale.terminalId,
      staffId: sale.staffId,
      // `sales_status_check` and `payments_method_check` keep the columns to these values.
      status: sale.status as SaleStatus,
      occurredAt: sale.occurredAt.toISOString(),
      voidedAt: sale.voidedAt?.toISOString() ?? null,
      subtotalCents: sale.subtotalCents,
      discountCents: sale.discountCents,
      taxCents: sale.taxCents,
      roundingCents: sale.roundingCents,
      totalCents: sale.totalCents,
      lines: sale.lines.map((line) => ({
        lineNo: line.lineNo,
        variantId: line.variantId,
        skuSnapshot: line.skuSnapshot,
        nameSnapshot: line.nameSnapshot,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        lineDiscountCents: line.lineDiscountCents,
        taxCents: line.taxCents,
        lineTotalCents: line.lineTotalCents,
        returnedQty: line.returnLines.reduce((total, returned) => total + returned.qty, 0),
      })),
      payments: sale.payments.map((payment) => ({
        ...payment,
        method: payment.method as TenderMethod,
      })),
    };
  }
}
