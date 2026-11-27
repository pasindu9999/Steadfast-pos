import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { getOutboxSummary } from '../db/outbox-repo';
import { getSetting } from '../db/settings-repo';
import { useServices } from '../ui/context';
import { badgeState } from './badge-state';

/** How often the age of the oldest unsynced sale is looked at again. */
const CLOCK_MS = 60_000;

/** The badge and its details, live from the database and the engine; `undefined` while loading. */
export function useSyncBadge() {
  const { database, now, sync } = useServices();
  const status = useStore(sync.status);
  const [tick, setTick] = useState(0);

  const saved = useLiveQuery(
    async () => {
      const [outbox, halt, lastSyncedAt] = await Promise.all([
        getOutboxSummary(database),
        getSetting(database, 'syncHalt'),
        getSetting(database, 'lastSyncedAt'),
      ]);
      return { ...outbox, halt: halt?.reason ?? null, lastSyncedAt, readAt: now() };
    },
    // A tick reads again, so a sale grows old with nothing else changing.
    [database, now, tick],
  );

  const waiting = (saved?.pending ?? 0) > 0;
  useEffect(() => {
    if (!waiting) return;
    const clock = setInterval(() => setTick((count) => count + 1), CLOCK_MS);
    return () => clearInterval(clock);
  }, [waiting]);

  if (!saved) return undefined;
  const { pending, failed, oldestPendingAt, halt, lastSyncedAt, readAt } = saved;
  const { reachable, syncing, storage } = status;
  const badge = badgeState({
    pending,
    failed: failed.length,
    oldestPendingAt,
    halt,
    reachable,
    storage,
    now: readAt,
  });
  return { badge, pending, failed, lastSyncedAt, syncing, syncNow: sync.syncNow };
}

export type SyncBadgeData = NonNullable<ReturnType<typeof useSyncBadge>>;
