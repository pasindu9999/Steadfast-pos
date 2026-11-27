import { getSetting } from '../db/settings-repo';
import { applyPull, type PullSummary } from './apply-pull';
import type { SyncDeps } from './sync-deps';

/** One pull: read the cursor, fetch outside any transaction, then apply (CLAUDE.md rule 4). */
export async function pullOnce({ database, createClient }: SyncDeps): Promise<PullSummary> {
  const [apiUrl, token, cursor] = await database.transaction('r', database.settings, () =>
    Promise.all([
      getSetting(database, 'apiUrl'),
      getSetting(database, 'deviceToken'),
      getSetting(database, 'pullCursor'),
    ]),
  );
  if (!apiUrl || !token) throw new Error('This terminal is not enrolled');

  const response = await createClient(apiUrl).pull(token, cursor);
  return applyPull(database, response, { requestCursor: cursor });
}
