/** Terminal registration (ARCH §4.3). */
import { z } from 'zod';

import { RECEIPT_CODE_PATTERN } from '../receipt-no.js';
import { lastSeqSchema, uuidSchema } from './primitives.js';

export const enrolRequestSchema = z.object({
  /** One-time code from the owner. Case and spaces don't matter. */
  enrolmentCode: z.string().trim().min(8).max(64),
});
export type EnrolRequest = z.infer<typeof enrolRequestSchema>;

export const enrolResponseSchema = z.object({
  terminalId: uuidSchema,
  terminalCode: z.string().regex(RECEIPT_CODE_PATTERN),
  /** Shown once: the server keeps only a hash (ARCH §11). */
  deviceToken: z.string().min(32),
  // High-water marks, so a re-enrolled device never reuses a number.
  lastAppliedSeq: lastSeqSchema,
  receiptSeq: lastSeqSchema,
  returnSeq: lastSeqSchema,
});
export type EnrolResponse = z.infer<typeof enrolResponseSchema>;
