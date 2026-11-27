import { z } from 'zod';

import type { TenderMethod } from '../cart.js';
import type { Discount } from '../discounts.js';
import { formatReceiptNo, formatReturnNo, parseReceiptNo, parseReturnNo } from '../receipt-no.js';
import type { RefundMethod } from '../returns.js';

/** Any UUID, e.g. a reference to a server-side row. */
export const uuidSchema = z.uuid();
/** A UUIDv7 generated on a terminal (ARCH §4.3). */
export const deviceIdSchema = z.uuidv7();

// Money and quantities are limited to int4, the column type in ARCH §6.2.
export const signedCentsSchema = z.int32();
export const centsSchema = z.int32().nonnegative();
export const qtySchema = z.int32().positive();
export const lineNoSchema = z.int32().positive();

/** A per-terminal event number (`bigint` on the server). */
export const seqSchema = z.int().positive();
/** A seq high-water mark; 0 means nothing has been applied. */
export const lastSeqSchema = z.int().nonnegative();

/** ISO-8601 in UTC, ending in `Z`. */
export const utcDateTimeSchema = z.iso.datetime();

export const receiptNoSchema = z.string().refine((value) => {
  const parts = parseReceiptNo(value);
  return parts !== null && formatReceiptNo(parts) === value;
}, 'not a receipt number');

export const returnNoSchema = z.string().refine((value) => {
  const parts = parseReturnNo(value);
  return parts !== null && formatReturnNo(parts) === value;
}, 'not a return number');

export const discountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), value: z.int().min(0).max(100) }),
  z.object({ type: z.literal('fixed'), value: centsSchema }),
]) satisfies z.ZodType<Discount>;

export const tenderMethodSchema = z.enum(['cash', 'card']) satisfies z.ZodType<TenderMethod>;

export const refundMethodSchema = z.enum([
  'cash',
  'card',
  'store_credit',
]) satisfies z.ZodType<RefundMethod>;
