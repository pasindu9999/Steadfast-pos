/** What the function keys and Escape do on the till (task P4-6). Pure functions only. */
import type { RegisterDialog } from './register-store';

export interface KeyPress {
  key: string;
  repeat: boolean;
  /** Ctrl, Alt or Meta is held: the key belongs to the browser. */
  modified: boolean;
}

export interface TillState {
  dialog: RegisterDialog['type'] | null;
  cartEmpty: boolean;
  /** Payment and discount keys act only where the sale is in view. */
  onSaleScreen: boolean;
}

export type Shortcut = 'cash' | 'exact' | 'card' | 'discount' | 'returns' | 'dismiss';

const ON_A_SALE: Readonly<Record<string, Shortcut>> = {
  F2: 'cash',
  F3: 'card',
  F4: 'discount',
};

const RETURNS_KEY = 'F8';

/** Keys the browser must not act on while the till is open. */
export const isTillKey = ({ key, modified }: KeyPress) =>
  !modified && (key === RETURNS_KEY || Object.hasOwn(ON_A_SALE, key));

export function shortcutFor(press: KeyPress, state: TillState): Shortcut | null {
  const { key, repeat, modified } = press;
  const { dialog, cartEmpty, onSaleScreen } = state;
  if (repeat || modified) return null;
  if (dialog === 'cash') return key === 'F2' ? 'exact' : null;
  // Each dialog closes itself on Escape.
  if (dialog !== null) return null;
  if (key === 'Escape') return 'dismiss';
  if (key === RETURNS_KEY) return 'returns';
  const selling = onSaleScreen && !cartEmpty;
  return selling && Object.hasOwn(ON_A_SALE, key) ? ON_A_SALE[key]! : null;
}
