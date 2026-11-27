import { MAX_LINE_QTY } from './cart';

/** A typed quantity. */
export function parseQuantity(text: string): { qty: number } | { error: string } {
  const trimmed = text.trim();
  const qty = /^\d+$/.test(trimmed) ? Number(trimmed) : 0;
  return qty >= 1 && qty <= MAX_LINE_QTY
    ? { qty }
    : { error: `Enter a whole number from 1 to ${MAX_LINE_QTY}.` };
}
