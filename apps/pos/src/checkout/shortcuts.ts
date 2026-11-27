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
}

export type Shortcut = 'cash' | 'exact' | 'card' | 'discount' | 'dismiss';

const ON_A_SALE: Readonly<Record<string, Shortcut>> = {
  F2: 'cash',
  F3: 'card',
  F4: 'discount',
};

/** Keys the browser must not act on while the till is open. */
export const isTillKey = ({ key, modified }: KeyPress) =>
  !modified && Object.hasOwn(ON_A_SALE, key);

export function shortcutFor(press: KeyPress, { dialog, cartEmpty }: TillState): Shortcut | null {
  const { key, repeat, modified } = press;
  if (repeat || modified) return null;
  if (dialog === 'cash') return key === 'F2' ? 'exact' : null;
  // Each dialog closes itself on Escape.
  if (dialog !== null) return null;
  if (key === 'Escape') return 'dismiss';
  return !cartEmpty && Object.hasOwn(ON_A_SALE, key) ? ON_A_SALE[key]! : null;
}
