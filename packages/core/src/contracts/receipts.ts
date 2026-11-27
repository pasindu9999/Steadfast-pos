/** Online receipt lookup across terminals (ARCH §7.4, Appendix A). */
import { z } from 'zod';

import { formatReceiptNo, parseReceiptNo } from '../receipt-no.js';
import { paymentSchema, saleCompletedPayloadSchema, saleLineSchema } from './events.js';
import { utcDateTimeSchema, uuidSchema } from './primitives.js';

/** A typed or scanned receipt number, in its printed form. */
export const receiptNoInputSchema = z
  .string()
  .max(64)
  .transform((value, context) => {
    const parts = parseReceiptNo(value);
    if (parts !== null) return formatReceiptNo(parts);
    context.addIssue({ code: 'custom', message: 'not a receipt number' });
    return z.NEVER;
  });

export const receiptLineSchema = saleLineSchema.omit({ lineId: true, discount: true }).extend({
  /** Units already returned, across all terminals that have synced. */
  returnedQty: z.int32().nonnegative(),
});
export type ReceiptLine = z.infer<typeof receiptLineSchema>;

export const receiptPaymentSchema = paymentSchema.omit({ paymentId: true });
export type ReceiptPayment = z.infer<typeof receiptPaymentSchema>;

export const saleStatusSchema = z.enum(['completed', 'voided']);
export type SaleStatus = z.infer<typeof saleStatusSchema>;

export const receiptLookupResponseSchema = saleCompletedPayloadSchema
  .pick({
    saleId: true,
    receiptNo: true,
    storeId: true,
    staffId: true,
    subtotalCents: true,
    discountCents: true,
    taxCents: true,
    roundingCents: true,
    totalCents: true,
  })
  .extend({
    terminalId: uuidSchema,
    status: saleStatusSchema,
    occurredAt: utcDateTimeSchema,
    voidedAt: utcDateTimeSchema.nullable(),
    lines: z.array(receiptLineSchema).min(1),
    payments: z.array(receiptPaymentSchema).min(1),
  });
export type ReceiptLookupResponse = z.infer<typeof receiptLookupResponseSchema>;
