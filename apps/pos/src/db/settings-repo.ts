import type { PosDatabase } from './database';
import type { HaltReason, SettingKey, SettingRow, SettingValues } from './types';

export async function getSetting<K extends SettingKey>(
  database: PosDatabase,
  key: K,
): Promise<SettingValues[K] | undefined> {
  const row = await database.settings.get(key);
  return row?.value as SettingValues[K] | undefined;
}

/** Writes the given settings together. `undefined` values are skipped. */
export async function putSettings(
  database: PosDatabase,
  values: Partial<SettingValues>,
): Promise<void> {
  const rows = (Object.entries(values) as [SettingKey, SettingRow['value'] | undefined][]).flatMap(
    ([key, value]) => (value === undefined ? [] : [{ key, value }]),
  );
  await database.settings.bulkPut(rows);
}

/** Stops automatic syncing until someone acts (ARCH §4.7). */
export function saveSyncHalt(database: PosDatabase, reason: HaltReason, now: Date) {
  return putSettings(database, { syncHalt: { reason, at: now.toISOString() } });
}

/** What the till shows and prices with. `undefined` until the first pull. */
export async function getTerminalInfo(database: PosDatabase) {
  const store = await getSetting(database, 'store');
  const terminalCode = await getSetting(database, 'terminalCode');
  return store && terminalCode ? { store, terminalCode } : undefined;
}

/** A terminal can sell only when `ready`: receipts need the store code from the first pull. */
export type TerminalState = 'not_enrolled' | 'needs_download' | 'ready';

export async function getTerminalState(database: PosDatabase): Promise<TerminalState> {
  const [token, store, cursor] = await database.settings.bulkGet([
    'deviceToken',
    'store',
    'pullCursor',
  ]);
  if (!token) return 'not_enrolled';
  return store && cursor ? 'ready' : 'needs_download';
}
