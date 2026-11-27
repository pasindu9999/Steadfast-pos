/** What the cashier is told when a return cannot be saved. Raw errors are never shown. */
import { isStorageFull } from '../checkout/checkout-message';
import { type ReturnFailure, ReturnRefusedError } from './return-error';

const REFUSALS: Record<ReturnFailure, string> = {
  NOT_READY: 'This terminal is not set up for returns yet. Ask a manager.',
  SALE_NOT_FOUND: 'That sale is not on this terminal. Look it up again.',
  SALE_VOIDED: 'This sale was voided, so nothing on it can be returned.',
  NOTHING_SELECTED: 'Choose the items to return.',
  OVER_RETURN: 'Part of this has already been returned. Check the quantities.',
  REASON_REQUIRED: 'Enter a reason for the return.',
  APPROVAL_REQUIRED: 'This return needs a manager’s approval.',
  INVALID_RETURN:
    'This return cannot be saved. Check the items and card reference, or ask a manager.',
};

const NOT_SAVED =
  'The return was not saved. Try again, and hand money back only once the return receipt shows.';

const DEVICE_FULL =
  "The return was not saved because this device's storage is full. Ask a manager to free some space, and do not hand money back yet.";

export function returnMessage(error: unknown): string {
  if (error instanceof ReturnRefusedError) return REFUSALS[error.code];
  return isStorageFull(error) ? DEVICE_FULL : NOT_SAVED;
}
