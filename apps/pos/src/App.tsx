import { useLiveQuery } from 'dexie-react-hooks';

import { db } from './db/database';
import { getTerminalState } from './db/settings-repo';
import { createApiClient } from './sync/api-client';
import { enrolTerminal } from './sync/enrol-terminal';
import { pullOnce } from './sync/pull-once';
import type { SyncDeps } from './sync/sync-deps';
import { EnrolmentScreen } from './ui/EnrolmentScreen';
import { PosApp } from './ui/PosApp';
import { createServices } from './ui/services';

const syncDeps: SyncDeps = {
  database: db,
  createClient: (baseUrl) => createApiClient({ baseUrl }),
};

const services = createServices(db);

async function download(): Promise<void> {
  await pullOnce(syncDeps);
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
