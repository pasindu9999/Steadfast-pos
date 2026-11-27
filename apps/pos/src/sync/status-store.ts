/**
 * What the sync engine is doing right now, for the badge (ARCH §4.8). Nothing here uses the
 * network, so screens may depend on it.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { StoragePersistence } from '../db/persist';

export interface SyncStatus {
  /** Whether the last request got through; `null` before the first one. */
  reachable: boolean | null;
  /** A sync cycle is running. */
  syncing: boolean;
  storage: StoragePersistence | 'unknown';
}

export type SyncStatusStore = StoreApi<SyncStatus>;

export function createSyncStatusStore(): SyncStatusStore {
  return createStore<SyncStatus>()(() => ({
    reachable: null,
    syncing: false,
    storage: 'unknown',
  }));
}

/** What the screens may ask of the sync engine. */
export interface SyncControls {
  status: SyncStatusStore;
  /** Starts syncing; the returned function stops it and removes every timer and listener. */
  start: () => () => void;
  /** "Sync now". */
  syncNow: () => void;
}

/** Controls that never touch the network, for screens shown without an engine. */
export function createIdleSyncControls(): SyncControls {
  return {
    status: createSyncStatusStore(),
    start: () => () => undefined,
    syncNow: () => undefined,
  };
}
