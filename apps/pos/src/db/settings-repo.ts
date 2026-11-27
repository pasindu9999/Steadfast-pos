import type { PosDatabase } from './database';
import type { SettingKey, SettingRow, SettingValues } from './types';

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
