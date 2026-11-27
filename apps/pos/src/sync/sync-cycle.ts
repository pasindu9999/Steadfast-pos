/**
 * One round of syncing, entirely under the sync lock: health check, push, then pull, so push and
 * pull never interleave (ARCH §4.6).
 */
import { getSetting, putSettings, saveSyncHalt } from '../db/settings-repo';
import type { HaltReason } from '../db/types';
import { ApiRequestError } from './api-client';
import { classifyFailure } from './classify-failure';
import { checkHealth } from './connectivity';
import type { SyncLock } from './lock';
import { pullOnce } from './pull-once';
import { type PushDeps, pushPending } from './push-pending';
import type { SyncStatusStore } from './status-store';

export interface CycleDeps extends PushDeps {
  lock: SyncLock;
  status: SyncStatusStore;
}

export interface CycleOptions {
  pull: boolean;
  /** "Sync now": tries even while halted. */
  manual: boolean;
}

export type CycleResult =
  | { status: 'ok'; pulled: boolean }
  /** Worth trying again later. */
  | { status: 'retry' }
  | { status: 'halted'; reason: HaltReason }
  /** The terminal is not enrolled. */
  | { status: 'skipped' };

async function pushThenPull(
  deps: CycleDeps,
  apiUrl: string,
  { pull }: CycleOptions,
): Promise<CycleResult> {
  const { database, createClient, now = () => new Date() } = deps;

  if (!(await checkHealth(createClient(apiUrl)))) return { status: 'retry' };

  const pushed = await pushPending(deps);
  if (pushed.status === 'halted') return pushed;
  // Only after a complete push: a pull marks everything up to `lastAppliedSeq` synced, which must
  // not hide an event the server rejected or never stored.
  if (pull) await pullOnce(deps);

  await database.transaction('rw', database.settings, async () => {
    await database.settings.delete('syncHalt');
    await putSettings(database, { lastSyncedAt: now().toISOString() });
  });
  return { status: 'ok', pulled: pull };
}

function failureResult(error: unknown): CycleResult {
  const action = classifyFailure(error);
  if (action.kind === 'halt') return { status: 'halted', reason: action.reason };
  // The kind and status only: nothing from a request or a response.
  const kind = error instanceof ApiRequestError ? error.message : (error as Error | null)?.name;
  console.warn('sync failed', kind);
  return { status: 'retry' };
}

export function runSyncCycle(deps: CycleDeps, options: CycleOptions): Promise<CycleResult> {
  const { database, lock, status, now = () => new Date() } = deps;

  return lock.run(async () => {
    // Read under the lock: another tab, or an earlier session, may have halted.
    const [apiUrl, halt] = await database.transaction('r', database.settings, () =>
      Promise.all([getSetting(database, 'apiUrl'), getSetting(database, 'syncHalt')]),
    );
    if (!apiUrl) return { status: 'skipped' };
    if (halt && !options.manual) return { status: 'halted', reason: halt.reason };

    status.setState({ syncing: true });
    try {
      const result = await pushThenPull(deps, apiUrl, options).catch(failureResult);
      if (result.status === 'halted') await saveSyncHalt(database, result.reason, now());
      // A halt is an answer from the server, so it was reached.
      status.setState({ reachable: result.status !== 'retry' });
      return result;
    } finally {
      status.setState({ syncing: false });
    }
  });
}
