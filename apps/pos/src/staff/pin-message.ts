import { formatStoreTime } from '../ui/format-time';
import type { PinResult } from './staff-pin';

export const PIN_FORMAT_MESSAGE = 'Enter 4 to 8 digits.';
export const PIN_ERROR_MESSAGE = "Couldn't check the PIN. Try again.";

/** What to tell staff when a PIN is not accepted. */
export function pinMessage(result: Exclude<PinResult, { status: 'ok' }>, timeZone: string): string {
  switch (result.status) {
    case 'wrong_pin': {
      const attempts = result.attemptsLeft === 1 ? 'attempt' : 'attempts';
      return `Wrong PIN. ${result.attemptsLeft} ${attempts} left.`;
    }
    case 'locked': {
      const until = formatStoreTime(result.lockedUntil, timeZone);
      return `Too many wrong PINs. Try again after ${until}.`;
    }
    case 'not_allowed':
      return "This person can't do that. Pick someone else.";
  }
}
