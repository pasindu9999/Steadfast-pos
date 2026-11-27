/** What the cashier is told when a sale can't be voided. Raw errors are never shown. */
import { isStorageFull } from '../checkout/checkout-message';
import { type VoidFailure, VoidRefusedError } from './void-error';

export const VOID_REFUSALS: Record<VoidFailure, string> = {
  OTHER_TERMINAL: 'Only the terminal that made a sale can void it. Use a return instead.',
  ALREADY_VOIDED: 'This sale has already been voided.',
  HAS_RETURNS: 'Part of this sale has been returned, so it can’t be voided. Return the rest.',
  NOT_TODAY: 'A sale can be voided only on the day it was made. Use a return instead.',
  NOT_READY: 'This terminal is not set up to void sales yet. Ask a manager.',
  APPROVAL_REQUIRED: 'A manager must approve this void.',
  INVALID_VOID: 'This sale cannot be voided. Ask a manager.',
};

const NOT_SAVED =
  'The sale was not voided. Try again, and hand money back only once it shows as voided.';

const DEVICE_FULL =
  "The sale was not voided because this device's storage is full. Ask a manager to free some space, and do not hand money back yet.";

export function voidMessage(error: unknown): string {
  if (error instanceof VoidRefusedError) return VOID_REFUSALS[error.code];
  return isStorageFull(error) ? DEVICE_FULL : NOT_SAVED;
}
