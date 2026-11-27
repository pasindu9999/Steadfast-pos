/**
 * The QR code on a receipt (ARCH §7.4). It lets either terminal take a return offline, even for a
 * sale the other one has not synced yet.
 */
import { z } from 'zod';

import { MAX_SALE_LINES } from './events.js';
import {
  centsSchema,
  deviceIdSchema,
  qtySchema,
  receiptNoSchema,
  uuidSchema,
} from './primitives.js';

/** `[variantId, qty, lineTotalCents]`. */
const receiptQrLineSchema = z.tuple([uuidSchema, qtySchema, centsSchema]);

export const receiptQrSchema = z.object({
  saleId: deviceIdSchema,
  receiptNo: receiptNoSchema,
  /** In `lineNo` order: the first entry is line 1. */
  lines: z.array(receiptQrLineSchema).min(1).max(MAX_SALE_LINES),
});
export type ReceiptQr = z.infer<typeof receiptQrSchema>;

export interface ReceiptQrSale {
  saleId: string;
  receiptNo: string;
  lines: readonly { lineNo: number; variantId: string; qty: number; lineTotalCents: number }[];
}

/** The text to put in the code. The lines must be numbered 1 to n, in any order. */
export function encodeReceiptQr({ saleId, receiptNo, lines }: ReceiptQrSale): string {
  const ordered = [...lines].sort((a, b) => a.lineNo - b.lineNo);
  if (ordered.some((line, index) => line.lineNo !== index + 1)) {
    throw new RangeError('receipt lines must be numbered from 1 with no gaps');
  }
  const payload: ReceiptQr = {
    saleId,
    receiptNo,
    lines: ordered.map((line) => [line.variantId, line.qty, line.lineTotalCents]),
  };
  return JSON.stringify(payload);
}

/** The payload in a scanned or pasted text, or `null` if it is not a whole receipt code. */
export function decodeReceiptQr(text: string): ReceiptQr | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = receiptQrSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The lines with their numbers: a line's number is its position in the code (ARCH §7.4). */
export function receiptQrLines({ lines }: ReceiptQr): ReceiptQrSale['lines'][number][] {
  return lines.map(([variantId, qty, lineTotalCents], index) => ({
    lineNo: index + 1,
    variantId,
    qty,
    lineTotalCents,
  }));
}
