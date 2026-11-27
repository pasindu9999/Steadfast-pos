/**
 * One sync worker per device (ARCH §4.5): push and pull run only while holding the Web Lock, so two
 * tabs, or a push and a pull, never overlap.
 */
export const SYNC_LOCK = 'sync';

/** The part of `navigator.locks` that is used. */
export interface LockManagerLike {
  request(name: string, work: () => Promise<unknown>): Promise<unknown>;
}

export interface SyncLock {
  /** Waits its turn, then runs `work` while holding the lock. */
  run<T>(work: () => Promise<T>): Promise<T>;
}

/** A lock manager for one JavaScript context: a queue per name. */
export function createMemoryLockManager(): LockManagerLike {
  const queues = new Map<string, Promise<unknown>>();
  return {
    request(name, work) {
      const turn = (queues.get(name) ?? Promise.resolve()).then(work);
      // A failure ends that turn only.
      queues.set(
        name,
        turn.catch(() => undefined),
      );
      return turn;
    },
  };
}

/** Without Web Locks one tab is still orderly; the server's row lock covers the rest. */
const fallback = createMemoryLockManager();

export function createSyncLock(
  manager: LockManagerLike = globalThis.navigator?.locks ?? fallback,
): SyncLock {
  return {
    run: <T>(work: () => Promise<T>) => manager.request(SYNC_LOCK, work) as Promise<T>,
  };
}
