import { useLiveQuery } from 'dexie-react-hooks';

import { db } from './db/database';
import { getTerminalState } from './db/settings-repo';
import { appUpdates } from './pwa/updates';
import { createApiClient } from './sync/api-client';
import { enrolTerminal } from './sync/enrol-terminal';
import { createSyncLock } from './sync/lock';
import { pullOnce } from './sync/pull-once';
import type { SyncDeps } from './sync/sync-deps';
import { createSyncEngine } from './sync/sync-engine';
import { EnrolmentScreen } from './ui/EnrolmentScreen';
import { PosApp } from './ui/PosApp';
import { createServices } from './ui/services';

const syncDeps: SyncDeps = {
  database: db,
  createClient: (baseUrl) => createApiClient({ baseUrl }),
};

const lock = createSyncLock();
const services = createServices(db, {
  sync: createSyncEngine({ ...syncDeps, lock }),
  updates: appUpdates,
});

/** The first download, under the same lock as every other push and pull (ARCH §4.5). */
async function download(): Promise<void> {
  await lock.run(() => pullOnce(syncDeps));
}

export function App() {
  const state = useLiveQuery(() => getTerminalState(db));

  if (state === 'ready') return <PosApp services={services} />;

  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-bold">Offline-First Apparel POS</h1>
      {state === undefined ? (
        <p>Starting…</p>
      ) : (
        <EnrolmentScreen
          state={state}
          defaultApiUrl={import.meta.env.VITE_API_URL ?? ''}
          onEnrol={async (input) => {
            await enrolTerminal(syncDeps, input);
            await download();
          }}
          onDownload={download}
        />
      )}
    </main>
  );
}
