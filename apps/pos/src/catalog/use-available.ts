import { useLiveQuery } from 'dexie-react-hooks';

import { db, type PosDatabase } from '../db/database';
import { getAvailable } from '../db/stock-repo';

/** Live available stock of one variant, or `undefined` while it loads. */
export function useAvailable(variantId: string, database: PosDatabase = db): number | undefined {
  const result = useLiveQuery(
    async () => ({ variantId, available: await getAvailable(database, variantId) }),
    [database, variantId],
  );
  // After a change of variant, `useLiveQuery` briefly still holds the previous answer.
  return result?.variantId === variantId ? result.available : undefined;
}
