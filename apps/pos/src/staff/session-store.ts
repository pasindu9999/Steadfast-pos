/** Who is serving. Kept in memory only, so a reload asks for a PIN again. */
import { createStore } from 'zustand/vanilla';

import type { LoginStaff } from './staff-pin';

export interface Session {
  staff: LoginStaff | null;
  signIn: (staff: LoginStaff) => void;
  signOut: () => void;
}

export function createSessionStore() {
  return createStore<Session>()((set) => ({
    staff: null,
    signIn: (staff) => set({ staff }),
    signOut: () => set({ staff: null }),
  }));
}
