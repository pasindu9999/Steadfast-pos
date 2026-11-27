/** What the sync badge shows (ARCH §4.8). A pure function of the outbox and the engine's state. */
import type { HaltReason } from '../db/types';
import type { SyncStatus } from './status-store';

/** An event unsent for longer than this needs someone to look. */
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export interface BadgeInput {
  pending: number;
  failed: number;
  oldestPendingAt: string | null;
  halt: HaltReason | null;
  reachable: SyncStatus['reachable'];
  storage: SyncStatus['storage'];
  now: Date;
}

export type BadgeTone = 'green' | 'blue' | 'amber' | 'red' | 'grey';

export interface BadgeState {
  tone: BadgeTone;
  label: string;
  /** Everything worth telling the cashier, whatever the colour. */
  reasons: string[];
}

const HALT_REASONS: Record<HaltReason, string> = {
  UNAUTHORIZED: 'The server no longer accepts this terminal. Ask the owner.',
  TERMINAL_MISMATCH: 'This terminal is signed in as another terminal. Ask the owner.',
  SEQ_REUSED:
    'The server has already used these sale numbers, so this terminal must be set up again. Its sales are still saved here.',
  SEQ_GAP: 'The server is missing sales that this terminal cannot send again. Ask the owner.',
};

function waitingLabel(pending: number): string {
  if (pending === 0) return 'Offline';
  return `Offline · ${pending} unsynced ${pending === 1 ? 'receipt' : 'receipts'}`;
}

export function badgeState(input: BadgeInput): BadgeState {
  const { pending, failed, oldestPendingAt, halt, reachable, storage, now } = input;
  const stale =
    oldestPendingAt !== null && now.getTime() - Date.parse(oldestPendingAt) > STALE_AFTER_MS;
  const notPersisted = storage === 'denied' || storage === 'unsupported';

  const reasons: string[] = [];
  if (halt) reasons.push(HALT_REASONS[halt]);
  if (failed > 0) {
    const receipts = failed === 1 ? 'receipt was' : 'receipts were';
    reasons.push(`${failed} ${receipts} refused by the server.`);
  }
  if (stale) reasons.push('Sales have been waiting to upload for over 2 hours.');
  if (notPersisted) {
    reasons.push('This browser may delete saved data. Install the app or allow it to keep data.');
  }

  const state = (tone: BadgeTone, label: string): BadgeState => ({ tone, label, reasons });

  // Unprotected data matters once it could be sent and has not been; offline it is only a warning.
  const atRisk = notPersisted && pending > 0 && reachable === true;
  if (halt || failed > 0 || stale || atRisk) return state('red', 'Needs attention');
  if (reachable === false) return state('amber', waitingLabel(pending));
  if (pending > 0) return state('blue', `Syncing · ${pending}`);
  if (reachable === null) return state('grey', 'Checking connection');
  return state('green', 'Online · All synced');
}
