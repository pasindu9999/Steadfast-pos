/** What the till screens need from outside, passed in so tests can replace it. */
import { createCartStore } from '../checkout/cart-store';
import { createRegisterStore } from '../checkout/register-store';
import type { PosDatabase } from '../db/database';
import { createSessionStore } from '../staff/session-store';
import { createBeep, type Tone } from './beep';
import { createFocusTarget, type FocusTarget } from './focus-target';

export interface Services {
  database: PosDatabase;
  now: () => Date;
  beep: (tone: Tone) => void;
  /** When a key was pressed, in milliseconds, for telling a scanner from a person. */
  keyTime: (event: KeyboardEvent) => number;
  stores: {
    cart: ReturnType<typeof createCartStore>;
    register: ReturnType<typeof createRegisterStore>;
    session: ReturnType<typeof createSessionStore>;
  };
  scanFocus: FocusTarget;
}

export function createServices(
  database: PosDatabase,
  overrides: Partial<Omit<Services, 'database' | 'stores'>> = {},
): Services {
  return {
    database,
    now: () => new Date(),
    beep: createBeep(),
    keyTime: (event) => event.timeStamp,
    stores: {
      cart: createCartStore(),
      register: createRegisterStore(),
      session: createSessionStore(),
    },
    scanFocus: createFocusTarget(),
    ...overrides,
  };
}
