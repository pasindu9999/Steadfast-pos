import type { PosDatabase } from './database';
import { getSetting } from './settings-repo';

/**
 * Who this terminal is and the last outbox number it used: what every event needs. Reads settings
 * only, so a commit can call it inside its transaction. `undefined` until the first pull.
 */
export async function readTerminalIdentity(database: PosDatabase) {
  const terminalId = await getSetting(database, 'terminalId');
  const terminalCode = await getSetting(database, 'terminalCode');
  const store = await getSetting(database, 'store');
  const outboxSeq = await getSetting(database, 'outboxSeq');
  if (!terminalId || !terminalCode || !store || outboxSeq === undefined) return undefined;
  return { terminalId, terminalCode, store, outboxSeq };
}
