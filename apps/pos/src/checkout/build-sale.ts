/**
 * Turns a cart into the `SALE_COMPLETED` event. Pure and synchronous, so it can run inside the
 * commit transaction. All pricing comes from `@pos/core`.
 */
import {
  calculateCart,
  type CartTotals,
  changeDueCents,
  LINE_NAME_MAX_LENGTH,
  type PaymentPayload,
  type PullStore,
  type SaleCompletedEvent,
  saleCompletedEventSchema,
  SCHEMA_VERSION,
  SKU_MAX_LENGTH,
} from '@pos/core';
import { v7 as uuidv7 } from 'uuid';

import { CheckoutError } from './checkout-error';
import { toStoreConfig } from './price-cart';
import type { SaleDraft, TenderInput } from './sale-draft';
import { toSnapshot, toStorableText } from './storable-text';

export interface SaleContext {
  terminalId: string;
  receiptNo: string;
  store: PullStore;
  seq: number;
  occurredAt: string;
}

function priceCart(
  { lines, cartDiscount }: SaleDraft,
  store: PullStore,
  tender: TenderInput,
): CartTotals {
  try {
    return calculateCart(lines, cartDiscount, toStoreConfig(store), tender.method);
  } catch (error) {
    if (error instanceof RangeError) throw new CheckoutError('INVALID_SALE', error.message);
    throw error;
  }
}

/** Optional text typed by the cashier. Blank means none. */
function typedText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  if (toStorableText(text) !== text) {
    throw new CheckoutError('INVALID_SALE', 'unreadable characters in a card field');
  }
  return text === '' ? null : text;
}

function buildPayment(tender: TenderInput, totalCents: number): PaymentPayload {
  const payment = { paymentId: uuidv7(), method: tender.method, amountCents: totalCents };
  switch (tender.method) {
    case 'cash': {
      const { tenderedCents } = tender;
      if (!Number.isSafeInteger(tenderedCents) || tenderedCents < 0) {
        throw new CheckoutError('INVALID_SALE', 'tendered cash must be whole cents');
      }
      if (tenderedCents < totalCents) throw new CheckoutError('INSUFFICIENT_TENDER');
      return {
        ...payment,
        tenderedCents,
        changeCents: changeDueCents(tenderedCents, totalCents),
        cardReference: null,
        cardLast4: null,
      };
    }
    case 'card':
      return {
        ...payment,
        tenderedCents: null,
        changeCents: null,
        cardReference: typedText(tender.cardReference),
        cardLast4: typedText(tender.cardLast4),
      };
  }
}

export function buildSaleEvent(
  draft: SaleDraft,
  tender: TenderInput,
  { terminalId, receiptNo, store, seq, occurredAt }: SaleContext,
): SaleCompletedEvent {
  if (draft.lines.length === 0) throw new CheckoutError('EMPTY_CART');
  const totals = priceCart(draft, store, tender);

  const event = saleCompletedEventSchema.safeParse({
    eventId: uuidv7(),
    terminalId,
    seq,
    type: 'SALE_COMPLETED',
    schemaVersion: SCHEMA_VERSION,
    occurredAt,
    payload: {
      saleId: uuidv7(),
      receiptNo,
      storeId: store.id,
      staffId: draft.staffId,
      cartDiscount: draft.cartDiscount,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      roundingCents: totals.roundingCents,
      totalCents: totals.totalCents,
      // `calculateCart` returns the lines in the order it was given them.
      lines: draft.lines.map((line, index) => {
        const priced = totals.lines[index]!;
        return {
          lineId: uuidv7(),
          lineNo: priced.lineNo,
          variantId: line.variantId,
          skuSnapshot: toSnapshot(line.sku, SKU_MAX_LENGTH),
          nameSnapshot: toSnapshot(line.name, LINE_NAME_MAX_LENGTH),
          qty: line.qty,
          unitPriceCents: line.unitPriceCents,
          discount: line.discount ?? null,
          lineDiscountCents: priced.discountCents,
          taxCents: priced.taxCents,
          lineTotalCents: priced.lineTotalCents,
        };
      }),
      payments: [buildPayment(tender, totals.totalCents)],
    },
  });
  // The last gate: an event the server would reject must never reach the outbox.
  if (!event.success) {
    const fields = event.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new CheckoutError('INVALID_SALE', fields);
  }
  return event.data;
}
