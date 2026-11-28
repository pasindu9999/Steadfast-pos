/** Whether the app may be reloaded without losing anything (ARCH §7.6). */
import type { RegisterDialog } from '../checkout/register-store';

export interface TillActivity {
  signedIn: boolean;
  /** The router's path. */
  path: string;
  cartLines: number;
  committing: boolean;
  dialog: RegisterDialog['type'] | null;
}

/**
 * Between sales: nothing in the cart, nothing being saved and no step open. Once someone is signed
 * in, only the sale screen counts: Returns holds a half-filled form, and a receipt may still be
 * showing the change to hand over.
 */
export function isTillIdle({ signedIn, path, cartLines, committing, dialog }: TillActivity) {
  if (cartLines > 0 || committing || dialog !== null) return false;
  return !signedIn || path === '/';
}
