/**
 * Offline PIN checks for login and manager approval (ARCH §11). Staff and their PBKDF2 hashes
 * arrive with the pull; `@pos/core` verifies them with WebCrypto.
 */
import { isValidPin, type StaffRole, verifyPin } from '@pos/core';

import type { PosDatabase } from '../db/database';
import { getSetting, putSettings } from '../db/settings-repo';
import type { PinAttempt, StaffRow } from '../db/types';

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 5 * 60_000;

/** Higher ranks may do everything lower ones can. */
const RANK: Record<StaffRole, number> = { cashier: 0, manager: 1, owner: 2 };

export type LoginStaff = Pick<StaffRow, 'id' | 'name' | 'role'>;

export type PinResult =
  | { status: 'ok'; staff: LoginStaff }
  | { status: 'wrong_pin'; attemptsLeft: number }
  | { status: 'locked'; lockedUntil: string }
  /** Unknown, inactive or not senior enough. */
  | { status: 'not_allowed' };

export interface PinCheck {
  staffId: string;
  pin: string;
  /** `manager` for an approval at the till. */
  minRole?: StaffRole;
  now?: () => Date;
}

const mayActAs = (member: StaffRow, minRole: StaffRole) =>
  member.isActive && RANK[member.role] >= RANK[minRole];

const toLoginStaff = ({ id, name, role }: StaffRow): LoginStaff => ({ id, name, role });

/** The people who can be picked on the login or approval screen. */
export async function listLoginStaff(
  database: PosDatabase,
  { minRole = 'cashier' }: { minRole?: StaffRole } = {},
): Promise<LoginStaff[]> {
  const staff = await database.staff.toArray();
  return staff
    .filter((member) => mayActAs(member, minRole))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toLoginStaff);
}

/**
 * Counts the attempt before the PIN is checked, so attempts made at the same moment can't get past
 * the limit. Returns the person's state including this attempt, or the reason there isn't one.
 */
function reserveAttempt(
  database: PosDatabase,
  { staffId, pin }: PinCheck,
  at: number,
): Promise<{ reserved: PinAttempt } | { refused: PinResult }> {
  return database.transaction('rw', database.settings, async () => {
    const attempts = (await getSetting(database, 'pinAttempts')) ?? {};
    const stored = attempts[staffId];
    const expired = stored?.lockedUntil != null && Date.parse(stored.lockedUntil) <= at;
    const current = stored && !expired ? stored : { failures: 0, lockedUntil: null };

    if (current.lockedUntil !== null) {
      return { refused: { status: 'locked', lockedUntil: current.lockedUntil } as const };
    }
    // Something that can't be a PIN is a typing slip, not a guess.
    if (!isValidPin(pin)) {
      const attemptsLeft = MAX_PIN_ATTEMPTS - current.failures;
      return { refused: { status: 'wrong_pin', attemptsLeft } as const };
    }

    const failures = current.failures + 1;
    const reserved: PinAttempt = {
      failures,
      lockedUntil: failures >= MAX_PIN_ATTEMPTS ? new Date(at + PIN_LOCK_MS).toISOString() : null,
    };
    await putSettings(database, { pinAttempts: { ...attempts, [staffId]: reserved } });
    return { reserved };
  });
}

function clearAttempts(database: PosDatabase, staffId: string): Promise<void> {
  return database.transaction('rw', database.settings, async () => {
    const attempts = { ...(await getSetting(database, 'pinAttempts')) };
    delete attempts[staffId];
    await putSettings(database, { pinAttempts: attempts });
  });
}

/** Don't call this inside a Dexie transaction: the hashing would end it (CLAUDE.md rule 4). */
export async function verifyStaffPin(database: PosDatabase, check: PinCheck): Promise<PinResult> {
  const { staffId, pin, minRole = 'cashier', now = () => new Date() } = check;
  const member = await database.staff.get(staffId);
  if (!member || !mayActAs(member, minRole)) return { status: 'not_allowed' };

  const attempt = await reserveAttempt(database, check, now().getTime());
  if ('refused' in attempt) return attempt.refused;

  // PBKDF2 runs between the two transactions.
  if (await verifyPin(pin, member.pinHash)) {
    await clearAttempts(database, staffId);
    return { status: 'ok', staff: toLoginStaff(member) };
  }
  const { failures, lockedUntil } = attempt.reserved;
  return lockedUntil === null
    ? { status: 'wrong_pin', attemptsLeft: MAX_PIN_ATTEMPTS - failures }
    : { status: 'locked', lockedUntil };
}
