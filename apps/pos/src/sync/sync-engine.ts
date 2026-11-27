/** The terminal's one sync engine: triggers feed the scheduler, which runs cycles. */
import { requestPersistentStorage, type StoragePersistence } from '../db/persist';
import { createSyncChannel, shareStatus, type SyncChannel } from './channel';
import { createSyncScheduler } from './scheduler';
import { createSyncStatusStore, type SyncControls } from './status-store';
import { type CycleDeps, runSyncCycle } from './sync-cycle';
import { type BrowserTargets, watchBrowser, watchOutbox } from './triggers';

export interface SyncEngineOptions extends Omit<CycleDeps, 'status'> {
  random?: () => number;
  targets?: () => BrowserTargets;
  checkStorage?: () => Promise<StoragePersistence>;
  createChannel?: () => SyncChannel;
}

/** Creating it touches no browser API; only `start` does. */
export function createSyncEngine({
  random,
  targets = () => ({ window, document }),
  checkStorage = () => requestPersistentStorage(),
  createChannel = createSyncChannel,
  ...deps
}: SyncEngineOptions): SyncControls {
  const status = createSyncStatusStore();
  const scheduler = createSyncScheduler({
    run: (options) => runSyncCycle({ ...deps, status }, options),
    random,
  });

  return {
    status,
    start() {
      const channel = createChannel();
      // Before the first cycle, so its news reaches the other tabs.
      const unshare = shareStatus(status, channel);
      scheduler.start();
      const stops = [
        watchBrowser(targets(), scheduler.trigger),
        watchOutbox(deps.database, {
          onCommit: () => scheduler.trigger('commit'),
          onPending: scheduler.setPending,
        }),
      ];
      void checkStorage().then((storage) => status.setState({ storage }));
      return () => {
        stops.forEach((stop) => stop());
        scheduler.stop();
        unshare();
        channel.close();
      };
    },
    syncNow: () => scheduler.trigger('manual'),
  };
}
