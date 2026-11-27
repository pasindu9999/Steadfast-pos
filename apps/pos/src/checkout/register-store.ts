/** What the till screen is doing right now: the search, the open dialog and messages. */
import { createStore } from 'zustand/vanilla';

import type { LoginStaff } from '../staff/staff-pin';

/** How long a scanned line stays highlighted. */
export const FLASH_MS = 1000;

export type DiscountTarget = { type: 'cart' } | { type: 'line'; key: string };

export type RegisterDialog =
  | { type: 'approval'; reason: string; onApproved: (approver: LoginStaff) => void }
  | { type: 'misc_item'; code: string }
  | { type: 'quantity'; key: string }
  | { type: 'discount'; target: DiscountTarget }
  | { type: 'clear_sale' }
  | { type: 'cash' }
  | { type: 'card' }
  | { type: 'parked' };

export type Notice = { type: 'not_found'; code: string } | { type: 'message'; text: string };

interface RegisterValues {
  search: string;
  /** The search result chosen with the arrow keys. */
  highlighted: number | null;
  dialog: RegisterDialog | null;
  /** A scan arrived while a dialog was open. */
  scanIgnored: boolean;
  notice: Notice | null;
  /** Read out by screen readers. */
  announcement: string;
  flashKey: string | null;
}

export interface RegisterState extends RegisterValues {
  setSearch: (search: string) => void;
  highlight: (index: number) => void;
  openDialog: (dialog: RegisterDialog) => void;
  closeDialog: () => void;
  ignoreScan: () => void;
  showNotice: (notice: Notice) => void;
  /** Clears the search and any message. */
  dismiss: () => void;
  /** A line was added or changed by a scan or a search. */
  added: (key: string, announcement: string) => void;
  reset: () => void;
}

const INITIAL: RegisterValues = {
  search: '',
  highlighted: null,
  dialog: null,
  scanIgnored: false,
  notice: null,
  announcement: '',
  flashKey: null,
};

export function createRegisterStore() {
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  return createStore<RegisterState>()((set) => ({
    ...INITIAL,
    setSearch: (search) => set({ search, highlighted: null }),
    highlight: (highlighted) => set({ highlighted }),
    openDialog: (dialog) => set({ dialog, scanIgnored: false }),
    closeDialog: () => set({ dialog: null, scanIgnored: false }),
    ignoreScan: () => set({ scanIgnored: true }),
    showNotice: (notice) => set({ notice, search: '', highlighted: null }),
    dismiss: () => set({ notice: null, search: '', highlighted: null }),
    added: (flashKey, announcement) => {
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => set({ flashKey: null }), FLASH_MS);
      set({ flashKey, announcement, notice: null, search: '', highlighted: null });
    },
    reset: () => {
      clearTimeout(flashTimer);
      set(INITIAL);
    },
  }));
}
