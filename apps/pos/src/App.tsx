import { useLiveQuery } from 'dexie-react-hooks';

import { loadCatalogIndex } from './catalog/load-catalog-index';
import { db } from './db/database';
import { getTerminalState } from './db/settings-repo';
import { createApiClient } from './sync/api-client';
import { enrolTerminal } from './sync/enrol-terminal';
import { pullOnce } from './sync/pull-once';
import type { SyncDeps } from './sync/sync-deps';
import { EnrolmentScreen } from './ui/EnrolmentScreen';

const syncDeps: SyncDeps = {
  database: db,
  createClient: (baseUrl) => createApiClient({ baseUrl }),
};

async function download(): Promise<void> {
  await pullOnce(syncDeps);
}

export function App() {
  const state = useLiveQuery(() => getTerminalState(db));
  // Built at start-up, and again only when the stored catalogue changes.
  const catalog = useLiveQuery(() => loadCatalogIndex(db));

  return (
    <main>
      <h1>Offline-First Apparel POS</h1>
      {state === undefined ? (
        <p>Starting…</p>
      ) : state === 'ready' ? (
        <p>Terminal ready. {catalog ? `${catalog.size} items loaded.` : 'Loading catalogue…'}</p>
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
