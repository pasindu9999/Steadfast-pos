/** Builds events the way a terminal does, priced by `@pos/core`. */
import {
  applyRefundRounding,
  calculateCart,
  type Discount,
  formatReceiptNo,
  formatReturnNo,
  type RefundMethod,
  refundForLines,
  returnCompletedEventSchema,
  type ReturnCompletedEvent,
  saleCompletedEventSchema,
  type SaleCompletedEvent,
  saleVoidedEventSchema,
  type SaleVoidedEvent,
  type TenderMethod,
} from '@pos/core';
import { v7 as uuidv7 } from 'uuid';

import type { Shop, TestTerminal } from './shop.js';

export interface SaleLineOptions {
  variantId?: string;
  qty?: number;
  unitPriceCents?: number;
  discount?: Discount | null;
}

export interface SaleOptions {
  seq: number;
  /** Defaults to `seq`. */
  receiptSeq?: number;
  lines?: SaleLineOptions[];
  cartDiscount?: Discount | null;
  tender?: TenderMethod;
  occurredAt?: string;
}

export function saleEvent(
  shop: Shop,
  terminal: TestTerminal,
  options: SaleOptions,
): SaleCompletedEvent {
  const { seq, receiptSeq = seq, lines = [{}], cartDiscount = null, tender = 'cash' } = options;
  const cart = lines.map((line) => ({
    variantId: line.variantId ?? shop.variant.id,
    qty: line.qty ?? 1,
    unitPriceCents: line.unitPriceCents ?? shop.variant.priceCents,
    discount: line.discount ?? null,
  }));
  const totals = calculateCart(
    cart,
    cartDiscount,
    { ...shop.store, storeId: shop.store.id },
    tender,
  );

  return saleCompletedEventSchema.parse({
    eventId: uuidv7(),
    terminalId: terminal.id,
    seq,
    type: 'SALE_COMPLETED',
    schemaVersion: 1,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    payload: {
      saleId: uuidv7(),
      receiptNo: formatReceiptNo({
        storeCode: shop.store.code,
        terminalCode: terminal.code,
        seq: receiptSeq,
      }),
      storeId: shop.store.id,
      staffId: shop.staff.id,
      cartDiscount,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      roundingCents: totals.roundingCents,
      totalCents: totals.totalCents,
      lines: totals.lines.map((line, index) => ({
        lineId: uuidv7(),
        lineNo: line.lineNo,
        variantId: line.variantId,
        skuSnapshot: 'LIN-BLK-M',
        nameSnapshot: 'Linen Shirt — Black / M',
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        discount: cart[index]!.discount,
        lineDiscountCents: line.discountCents,
        taxCents: line.taxCents,
        lineTotalCents: line.lineTotalCents,
      })),
      payments: [
        {
          paymentId: uuidv7(),
          method: tender,
          amountCents: totals.totalCents,
          tenderedCents: tender === 'cash' ? totals.totalCents : null,
          changeCents: tender === 'cash' ? 0 : null,
          cardReference: null,
          cardLast4: null,
        },
      ],
    },
  });
}

export function voidEvent(
  terminal: TestTerminal,
  sale: SaleCompletedEvent,
  { seq, reason = 'Rung up twice' }: { seq: number; reason?: string },
): SaleVoidedEvent {
  const { saleId, receiptNo, staffId } = sale.payload;
  return saleVoidedEventSchema.parse({
    eventId: uuidv7(),
    terminalId: terminal.id,
    seq,
    type: 'SALE_VOIDED',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: { saleId, receiptNo, staffId, reason },
  });
}

export interface ReturnOptions {
  seq: number;
  /** Defaults to `seq`. */
  returnSeq?: number;
  /** `[lineNo, qty]` pairs. Defaults to everything on the sale. */
  qtys?: [number, number][];
  /** What the terminal knows was already returned, by line number. */
  returned?: [number, number][];
  restock?: boolean;
  method?: RefundMethod;
}

export function returnEvent(
  shop: Shop,
  terminal: TestTerminal,
  sale: SaleCompletedEvent,
  options: ReturnOptions,
): ReturnCompletedEvent {
  const { seq, returnSeq = seq, restock = true, method = 'cash' } = options;
  const sold = sale.payload.lines;
  const returned = new Map(options.returned);
  const refund = refundForLines(
    sold.map((line) => ({ ...line, returnedQty: returned.get(line.lineNo) ?? 0 })),
    new Map(options.qtys ?? sold.map((line) => [line.lineNo, line.qty])),
  );
  const { roundingCents, refundAmountCents } = applyRefundRounding(
    refund.refundTotalCents,
    method,
    shop.store.cashRoundingCents,
  );

  return returnCompletedEventSchema.parse({
    eventId: uuidv7(),
    terminalId: terminal.id,
    seq,
    type: 'RETURN_COMPLETED',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    payload: {
      returnId: uuidv7(),
      returnNo: formatReturnNo({
        storeCode: shop.store.code,
        terminalCode: terminal.code,
        seq: returnSeq,
      }),
      originalSaleId: sale.payload.saleId,
      storeId: shop.store.id,
      staffId: shop.staff.id,
      reason: 'Wrong size',
      refundTotalCents: refund.refundTotalCents,
      roundingCents,
      lines: refund.lines.map((line) => ({
        returnLineId: uuidv7(),
        saleLineNo: line.saleLineNo,
        variantId: sold.find((entry) => entry.lineNo === line.saleLineNo)!.variantId,
        qty: line.qty,
        refundCents: line.refundCents,
        restock,
      })),
      refunds: [
        { refundId: uuidv7(), method, amountCents: refundAmountCents, cardReference: null },
      ],
    },
  });
}
