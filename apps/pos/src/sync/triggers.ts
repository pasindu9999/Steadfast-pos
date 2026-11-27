/** What starts a sync from outside the scheduler (ARCH §4.7). Each returns its clean-up. */
import { liveQuery } from 'dexie';

import type { PosDatabase } from '../db/database';

export const COMMIT_DEBOUNCE_MS = 500;

export interface BrowserTargets {
  window: EventTarget;
  document: EventTarget & { visibilityState: DocumentVisibilityState };
}

export function watchBrowser(
  { window, document }: BrowserTargets,
  onTrigger: (trigger: 'online' | 'offline' | 'visible') => void,
): () => void {
  const online = () => onTrigger('online');
  // Not believed on its own: it only prompts a health check.
  const offline = () => onTrigger('offline');
  const visibility = () => {
    if (document.visibilityState === 'visible') onTrigger('visible');
  };
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    window.removeEventListener('online', online);
    window.removeEventListener('offline', offline);
    document.removeEventListener('visibilitychange', visibility);
  };
}

export interface OutboxHandlers {
  /** Shortly after new events were committed. */
  onCommit: () => void;
  /** Whether anything is waiting to be sent. */
  onPending: (pending: boolean) => void;
}

/**
 * Watches the outbox rather than being called by checkout, so the till never depends on the network
 * layer and sales committed in another tab are seen too.
 */
export function watchOutbox(
  database: PosDatabase,
  { onCommit, onPending }: OutboxHandlers,
): () => void {
  /** The highest seq seen; `null` until the first reading. */
  let newest: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const subscription = liveQuery(() =>
    database.outbox.where('status').equals('pending').primaryKeys(),
  ).subscribe({
    next: (seqs) => {
      onPending(seqs.length > 0);
      const latest = seqs.at(-1) ?? 0;
      // What was waiting already is sent by the start-up cycle.
      if (newest !== null && latest > newest) {
        clearTimeout(timer);
        timer = setTimeout(onCommit, COMMIT_DEBOUNCE_MS);
      }
      newest = Math.max(newest ?? 0, latest);
    },
    error: (error: unknown) => console.warn('outbox watch failed', (error as Error | null)?.name),
  });

  return () => {
    clearTimeout(timer);
    subscription.unsubscribe();
  };
}
