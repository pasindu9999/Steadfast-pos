/**
 * What was typed, pasted or scanned to find a sale (ARCH §7.4). A 2D scanner types the whole text of
 * a receipt's code. Pure.
 */
import {
  decodeReceiptQr,
  formatReceiptNo,
  parseReceiptNo,
  parseReturnNo,
  type ReceiptQr,
} from '@pos/core';

export type ParsedLookup =
  | { type: 'empty' }
  | { type: 'receipt_no'; receiptNo: string }
  | { type: 'qr'; qr: ReceiptQr }
  /** It starts like a receipt code but can't be read, such as one cut short. */
  | { type: 'invalid_qr' }
  /** The number of a return, which can't itself be returned. */
  | { type: 'return_no' }
  | { type: 'unrecognised' };

export function parseLookup(text: string): ParsedLookup {
  const entry = text.trim();
  if (entry === '') return { type: 'empty' };
  if (entry.startsWith('{')) {
    const qr = decodeReceiptQr(entry);
    return qr ? { type: 'qr', qr } : { type: 'invalid_qr' };
  }
  const receipt = parseReceiptNo(entry);
  if (receipt) return { type: 'receipt_no', receiptNo: formatReceiptNo(receipt) };
  return parseReturnNo(entry) ? { type: 'return_no' } : { type: 'unrecognised' };
}

/** Whether the till should open Returns for this text rather than look for an item. */
export function isReceiptEntry(text: string): boolean {
  const { type } = parseLookup(text);
  return type !== 'empty' && type !== 'unrecognised';
}
