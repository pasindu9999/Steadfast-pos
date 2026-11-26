/** Request and response bodies for push and pull (ARCH §4.4, §4.6). */
import { z } from 'zod';

import { RECEIPT_CODE_PATTERN } from '../receipt-no.js';
import { BP_SCALE } from '../tax.js';
import { errorDetailSchema } from './errors.js';
import { eventEnvelopeSchema } from './events.js';
import {
  centsSchema,
  deviceIdSchema,
  lastSeqSchema,
  seqSchema,
  utcDateTimeSchema,
  uuidSchema,
} from './primitives.js';

// Push ------------------------------------------------------------------------------

export const PUSH_BATCH_MAX = 50;

/** Events are validated loosely here and strictly one by one when applied. */
export const pushRequestSchema = z.object({
  terminalId: uuidSchema,
  events: z
    .array(eventEnvelopeSchema)
    .min(1)
    .max(PUSH_BATCH_MAX)
    .refine(
      (events) => events.every((event, index) => index === 0 || event.seq > events[index - 1]!.seq),
      'events must be in ascending seq order',
    ),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export const pushResultStatusSchema = z.enum(['applied', 'duplicate', 'parked', 'rejected']);
export type PushResultStatus = z.infer<typeof pushResultStatusSchema>;

export const pushResultSchema = z.object({
  eventId: deviceIdSchema,
  seq: seqSchema,
  status: pushResultStatusSchema,
  error: errorDetailSchema.nullable(),
});
export type PushResult = z.infer<typeof pushResultSchema>;

export const inventoryLevelSchema = z.object({
  variantId: uuidSchema,
  /** May be negative (ARCH §5). */
  onHand: z.int32(),
});
export type InventoryLevel = z.infer<typeof inventoryLevelSchema>;

export const pushResponseSchema = z.object({
  results: z.array(pushResultSchema),
  lastAppliedSeq: lastSeqSchema,
  inventory: z.array(inventoryLevelSchema),
});
export type PushResponse = z.infer<typeof pushResponseSchema>;

/** The 409 body: resend from `expectedSeq`. */
export const seqGapResponseSchema = z.object({
  error: z.object({ code: z.literal('SEQ_GAP'), message: z.string() }),
  expectedSeq: seqSchema,
});
export type SeqGapResponse = z.infer<typeof seqGapResponseSchema>;

// Pull ------------------------------------------------------------------------------

export const pullQuerySchema = z.object({
  /** Opaque; omitted on the first pull. */
  cursor: z.string().min(1).max(512).optional(),
});
export type PullQuery = z.infer<typeof pullQuerySchema>;

/** What a terminal needs to price sales and number receipts offline. */
export const pullStoreSchema = z.object({
  id: uuidSchema,
  code: z.string().regex(RECEIPT_CODE_PATTERN),
  name: z.string().min(1),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  taxRateBp: z.int().min(0).max(BP_SCALE),
  pricesIncludeTax: z.boolean(),
  cashRoundingCents: centsSchema,
});
export type PullStore = z.infer<typeof pullStoreSchema>;

export const pullProductSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  brand: z.string().nullable(),
  categoryId: uuidSchema.nullable(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  updatedAt: utcDateTimeSchema,
});
export type PullProduct = z.infer<typeof pullProductSchema>;

/** No cost price: terminals don't need it. */
export const pullVariantSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  sku: z.string().min(1),
  barcode: z.string().min(1).nullable(),
  size: z.string().min(1),
  sizeSort: z.int32(),
  color: z.string().min(1),
  priceCents: centsSchema,
  isActive: z.boolean(),
  updatedAt: utcDateTimeSchema,
});
export type PullVariant = z.infer<typeof pullVariantSchema>;

export const staffRoleSchema = z.enum(['cashier', 'manager', 'owner']);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const pullStaffSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  role: staffRoleSchema,
  /** PBKDF2, verified offline (ARCH §11). */
  pinHash: z.string().min(1),
  isActive: z.boolean(),
});
export type PullStaff = z.infer<typeof pullStaffSchema>;

export const pullResponseSchema = z.object({
  store: pullStoreSchema,
  products: z.array(pullProductSchema),
  variants: z.array(pullVariantSchema),
  staff: z.array(pullStaffSchema),
  inventory: z.array(inventoryLevelSchema),
  nextCursor: z.string().min(1),
  lastAppliedSeq: lastSeqSchema,
});
export type PullResponse = z.infer<typeof pullResponseSchema>;
