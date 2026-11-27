/** What the cashier is told when a lookup finds nothing. */
import type { LookupResult } from './lookup';

export type LookupMiss = Exclude<LookupResult, { status: 'found' }>;

export function lookupMessage(miss: LookupMiss): string | null {
  switch (miss.status) {
    case 'empty':
      return null;
    case 'not_on_terminal':
      return `${miss.receiptNo} is not on this terminal. Scan the code on the receipt. If it has none, use the terminal that made the sale.`;
    case 'other_store':
      return `${miss.receiptNo} is from another store.`;
    case 'invalid_qr':
      return 'That receipt code could not be read. Scan it again, or type the receipt number.';
    case 'return_no':
      return 'That is a return receipt. Use the number or code on the sale receipt.';
    case 'unrecognised':
      return 'That is not a receipt number or receipt code.';
    default: {
      const unhandled: never = miss;
      return unhandled;
    }
  }
}
