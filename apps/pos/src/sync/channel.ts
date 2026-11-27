/**
 * Keeps the badge in step across tabs (ARCH §4.8). Only the tab holding the sync lock talks to the
 * server, so it tells the others what it learns. Counts come from the shared database instead.
 */
import type { SyncStatus, SyncStatusStore } from './status-store';

export const SYNC_CHANNEL = 'pos-sync';

export interface SyncChannel {
  post: (message: unknown) => void;
  /** Returns a function that stops listening. */
  subscribe: (listener: (message: unknown) => void) => () => void;
  close: () => void;
}

/** Channels that reach each other within one JavaScript context. */
export function createMemoryChannelHub(): () => SyncChannel {
  const open = new Set<Set<(message: unknown) => void>>();
  return () => {
    const listeners = new Set<(message: unknown) => void>();
    open.add(listeners);
    return {
      post(message) {
        if (!open.has(listeners)) return;
        for (const others of open) {
          if (others === listeners) continue;
          queueMicrotask(() => others.forEach((listener) => listener(message)));
        }
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      close() {
        open.delete(listeners);
        listeners.clear();
      },
    };
  };
}

/** Without `BroadcastChannel` each tab finds things out for itself. */
const fallback = createMemoryChannelHub();

export function createSyncChannel(): SyncChannel {
  if (typeof globalThis.BroadcastChannel !== 'function') return fallback();
  const channel = new BroadcastChannel(SYNC_CHANNEL);
  let closed = false;
  return {
    post(message) {
      // A closed BroadcastChannel throws.
      if (!closed) channel.postMessage(message);
    },
    subscribe(listener) {
      const receive = (event: MessageEvent) => listener(event.data);
      channel.addEventListener('message', receive);
      return () => channel.removeEventListener('message', receive);
    },
    close() {
      closed = true;
      channel.close();
    },
  };
}

/** Storage is not shared: every tab asks the browser itself. */
type SharedStatus = Partial<Pick<SyncStatus, 'reachable' | 'syncing'>>;

type Message = { type: 'hello' } | { type: 'status'; changes: SharedStatus };

/** Another tab may run an older build, so nothing is taken on trust. */
function readMessage(value: unknown): Message | null {
  if (typeof value !== 'object' || value === null) return null;
  const { type, reachable, syncing } = value as Record<string, unknown>;
  if (type === 'hello') return { type };
  if (type !== 'status') return null;
  const changes: SharedStatus = {};
  if (typeof reachable === 'boolean') changes.reachable = reachable;
  if (typeof syncing === 'boolean') changes.syncing = syncing;
  return { type, changes };
}

/** Publishes this tab's changes and takes the others'. Returns a function that stops both. */
export function shareStatus(status: SyncStatusStore, channel: SyncChannel): () => void {
  /** Set while taking another tab's news, so it is not sent back. */
  let receiving = false;

  const unsubscribe = status.subscribe((next, previous) => {
    if (receiving) return;
    const changes: SharedStatus = {};
    // "Not checked yet" is never news.
    if (next.reachable !== previous.reachable && next.reachable !== null) {
      changes.reachable = next.reachable;
    }
    if (next.syncing !== previous.syncing) changes.syncing = next.syncing;
    if (Object.keys(changes).length > 0) channel.post({ type: 'status', ...changes });
  });

  const unlisten = channel.subscribe((value) => {
    const message = readMessage(value);
    if (message === null) return;
    if (message.type === 'hello') {
      const { reachable, syncing } = status.getState();
      if (reachable !== null) channel.post({ type: 'status', reachable, syncing });
      return;
    }
    receiving = true;
    status.setState(message.changes);
    receiving = false;
  });

  channel.post({ type: 'hello' });

  return () => {
    unsubscribe();
    unlisten();
  };
}
