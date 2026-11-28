/** What the till screens need from outside, passed in so tests can replace it. */
import { createCartStore } from '../checkout/cart-store';
import { createRegisterStore } from '../checkout/register-store';
import type { PosDatabase } from '../db/database';
import { createPrinter, type Printer } from '../print/print-service';
import { createIdleUpdates, type UpdateControls } from '../pwa/app-updater';
import { createSessionStore } from '../staff/session-store';
import { createIdleSyncControls, type SyncControls } from '../sync/status-store';
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
  /** The sync engine. Checkout never waits for it (CLAUDE.md rule 1). */
  sync: SyncControls;
  /** New versions of the app, applied only between sales. */
  updates: UpdateControls;
  /** Receipts go to paper through the browser. */
  printer: Printer;
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
    sync: createIdleSyncControls(),
    updates: createIdleUpdates(),
    printer: createPrinter(),
    ...overrides,
  };
}
