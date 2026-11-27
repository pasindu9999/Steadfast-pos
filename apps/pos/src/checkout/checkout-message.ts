/** What the cashier is told when a sale cannot be saved. Raw errors are never shown. */
import { CheckoutError, type CheckoutFailure } from './checkout-error';

const REFUSALS: Record<CheckoutFailure, string> = {
  NOT_READY: 'This terminal is not set up for sales yet. Ask a manager.',
  EMPTY_CART: 'There is nothing to sell.',
  INSUFFICIENT_TENDER: 'The cash received is less than the total.',
  INVALID_SALE: 'This sale cannot be saved. Check the items and card details, or ask a manager.',
};

const NOT_SAVED =
  'The sale was not saved. Try again. If you have already been paid, do not charge the customer twice.';

const DEVICE_FULL =
  "The sale was not saved because this device's storage is full. Ask a manager to free some space. Do not charge the customer twice.";

export function isStorageFull(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // Dexie wraps the browser's error and keeps it as `inner`.
  return error.name === 'QuotaExceededError' || ('inner' in error && isStorageFull(error.inner));
}

export function checkoutMessage(error: unknown): string {
  if (error instanceof CheckoutError) return REFUSALS[error.code];
  return isStorageFull(error) ? DEVICE_FULL : NOT_SAVED;
}
