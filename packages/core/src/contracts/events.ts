/**
 * The immutable facts a terminal sends (ARCH §4.1).
 *
 * These schemas check shape and database limits only, never arithmetic: a paid sale whose totals
 * look wrong must still be accepted and flagged (ARCH §5.4), so it has to pass validation.
 */
import { z } from 'zod';

import {
  centsSchema,
  deviceIdSchema,
  discountSchema,
  lineNoSchema,
  qtySchema,
  receiptNoSchema,
  refundMethodSchema,
  returnNoSchema,
  seqSchema,
  signedCentsSchema,
  tenderMethodSchema,
  utcDateTimeSchema,
  uuidSchema,
} from './primitives.js';

export const SCHEMA_VERSION = 1;
export const EVENT_TYPES = ['SALE_COMPLETED', 'SALE_VOIDED', 'RETURN_COMPLETED'] as const;
export const eventTypeSchema = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof eventTypeSchema>;

const reasonSchema = z.string().max(500).nullable();
const cardReferenceSchema = z.string().min(1).max(64).nullable();

/** Matches the unique constraints the database would otherwise fail on. */
function isUniqueBy<T>(items: readonly T[], key: (item: T) => string | number): boolean {
  return new Set(items.map(key)).size === items.length;
}

export const saleLineSchema = z.object({
  lineId: deviceIdSchema,
  lineNo: lineNoSchema,
  variantId: uuidSchema,
  skuSnapshot: z.string().min(1).max(64),
  nameSnapshot: z.string().min(1).max(200),
  qty: qtySchema,
  unitPriceCents: centsSchema,
  /** The line discount as entered, so the server can recompute the sale. */
  discount: discountSchema.nullable(),
  /** Own plus allocated cart discount. */
  lineDiscountCents: centsSchema,
  taxCents: centsSchema,
  lineTotalCents: centsSchema,
});
export type SaleLinePayload = z.infer<typeof saleLineSchema>;

export const paymentSchema = z.object({
  paymentId: deviceIdSchema,
  method: tenderMethodSchema,
  amountCents: centsSchema,
  tenderedCents: centsSchema.nullable(),
  changeCents: centsSchema.nullable(),
  cardReference: cardReferenceSchema,
  /** Never more than the last four digits (ARCH §11). */
  cardLast4: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
});
export type PaymentPayload = z.infer<typeof paymentSchema>;

export const saleCompletedPayloadSchema = z.object({
  saleId: deviceIdSchema,
  receiptNo: receiptNoSchema,
  storeId: uuidSchema,
  staffId: uuidSchema.nullable(),
  cartDiscount: discountSchema.nullable(),
  subtotalCents: centsSchema,
  discountCents: centsSchema,
  taxCents: centsSchema,
  roundingCents: signedCentsSchema,
  totalCents: centsSchema,
  lines: z
    .array(saleLineSchema)
    .min(1)
    .max(200)
    .refine((lines) => isUniqueBy(lines, (line) => line.lineNo), 'duplicate lineNo')
    .refine((lines) => isUniqueBy(lines, (line) => line.lineId), 'duplicate lineId'),
  payments: z
    .array(paymentSchema)
    .min(1)
    .max(10)
    .refine(
      (payments) => isUniqueBy(payments, (payment) => payment.paymentId),
      'duplicate paymentId',
    ),
});
export type SaleCompletedPayload = z.infer<typeof saleCompletedPayloadSchema>;

export const saleVoidedPayloadSchema = z.object({
  saleId: deviceIdSchema,
  receiptNo: receiptNoSchema,
  staffId: uuidSchema.nullable(),
  reason: reasonSchema,
});
export type SaleVoidedPayload = z.infer<typeof saleVoidedPayloadSchema>;

export const returnLineSchema = z.object({
  returnLineId: deviceIdSchema,
  /** `lineNo` on the original sale; the server resolves it to the sale line. */
  saleLineNo: lineNoSchema,
  variantId: uuidSchema,
  qty: qtySchema,
  refundCents: centsSchema,
  /** `false` for damaged goods: no stock movement. */
  restock: z.boolean(),
});
export type ReturnLinePayload = z.infer<typeof returnLineSchema>;

export const refundSchema = z.object({
  refundId: deviceIdSchema,
  method: refundMethodSchema,
  amountCents: centsSchema,
  cardReference: cardReferenceSchema,
});
export type RefundPayload = z.infer<typeof refundSchema>;

export const returnCompletedPayloadSchema = z.object({
  returnId: deviceIdSchema,
  returnNo: returnNoSchema,
  originalSaleId: deviceIdSchema,
  storeId: uuidSchema,
  staffId: uuidSchema.nullable(),
  reason: reasonSchema,
  /** Exact sum of the line refunds. */
  refundTotalCents: centsSchema,
  /** Cash rounding: the money handed back is `refundTotalCents + roundingCents`. */
  roundingCents: signedCentsSchema,
  lines: z
    .array(returnLineSchema)
    .min(1)
    .max(200)
    .refine((lines) => isUniqueBy(lines, (line) => line.returnLineId), 'duplicate returnLineId')
    .refine((lines) => isUniqueBy(lines, (line) => line.saleLineNo), 'duplicate saleLineNo'),
  refunds: z
    .array(refundSchema)
    .min(1)
    .max(10)
    .refine((refunds) => isUniqueBy(refunds, (refund) => refund.refundId), 'duplicate refundId'),
});
export type ReturnCompletedPayload = z.infer<typeof returnCompletedPayloadSchema>;

const envelopeShape = {
  eventId: deviceIdSchema,
  terminalId: uuidSchema,
  seq: seqSchema,
  /** Device clock: for reports, never for correctness. */
  occurredAt: utcDateTimeSchema,
};

/**
 * Only what the server needs to record an event. `type`, `schemaVersion` and `payload` are left open
 * so that a bad event can be stored as rejected and the queue can advance (ARCH §4.4 step 5).
 */
export const eventEnvelopeSchema = z.object({
  ...envelopeShape,
  type: z.string().min(1).max(64),
  schemaVersion: z.int().positive(),
  payload: z.unknown(),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

const versionedShape = { ...envelopeShape, schemaVersion: z.literal(SCHEMA_VERSION) };

export const saleCompletedEventSchema = z.object({
  ...versionedShape,
  type: z.literal('SALE_COMPLETED'),
  payload: saleCompletedPayloadSchema,
});
export type SaleCompletedEvent = z.infer<typeof saleCompletedEventSchema>;

export const saleVoidedEventSchema = z.object({
  ...versionedShape,
  type: z.literal('SALE_VOIDED'),
  payload: saleVoidedPayloadSchema,
});
export type SaleVoidedEvent = z.infer<typeof saleVoidedEventSchema>;

export const returnCompletedEventSchema = z.object({
  ...versionedShape,
  type: z.literal('RETURN_COMPLETED'),
  payload: returnCompletedPayloadSchema,
});
export type ReturnCompletedEvent = z.infer<typeof returnCompletedEventSchema>;

/** The strict contract, applied to each envelope. */
export const syncEventSchema = z.discriminatedUnion('type', [
  saleCompletedEventSchema,
  saleVoidedEventSchema,
  returnCompletedEventSchema,
]);
export type SyncEvent = z.infer<typeof syncEventSchema>;
