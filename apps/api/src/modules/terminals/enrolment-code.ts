import { sha256Hex } from '../../common/sha256.js';

/** Codes are typed by hand, so case and spaces don't matter. */
export function hashEnrolmentCode(code: string): string {
  return sha256Hex(code.replace(/\s+/g, '').toUpperCase());
}
