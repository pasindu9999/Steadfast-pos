/**
 * Registers the service worker and applies a new version only when asked, and only between sales
 * (ARCH §7.6). The page is never reloaded on its own, even after another tab has updated.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';

/** A till can stay open for weeks without a navigation, which is when browsers look. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

const SERVICE_WORKER_URL = '/sw.js';

export interface UpdateStatus {
  /** A new version is waiting, or has already taken over and needs a reload. */
  available: boolean;
  /** Asked for; the page reloads once the new version has taken over. */
  applying: boolean;
}

export interface UpdateControls {
  status: StoreApi<UpdateStatus>;
  /** Registers and starts looking; the returned function stops looking. */
  start: () => () => void;
  /** Reloads into the new version. `isIdle` is asked again just before the page goes. */
  apply: (isIdle: () => boolean) => void;
}

type ListenerOptions = { signal: AbortSignal };

/** The parts of the browser's objects used here, so tests can stand in for them. */
export interface WorkerLike {
  readonly state: ServiceWorkerState;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void, options: ListenerOptions): void;
}

export interface RegistrationLike {
  readonly active: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  readonly installing: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void, options: ListenerOptions): void;
  update(): Promise<unknown>;
}

export interface ContainerLike {
  register(url: string): Promise<RegistrationLike>;
}

export interface UpdaterOptions {
  /** `undefined` where service workers are unsupported, or the page is not a secure context. */
  container?: () => ContainerLike | undefined;
  document?: () => EventTarget & { visibilityState: DocumentVisibilityState };
  reload?: () => void;
}

const createStatus = () =>
  createStore<UpdateStatus>()(() => ({ available: false, applying: false }));

/** Controls that register nothing, for development and screen tests. */
export function createIdleUpdates(): UpdateControls {
  return { status: createStatus(), start: () => () => undefined, apply: () => undefined };
}

/** Creating it touches no browser API; only `start` and `apply` do. */
export function createAppUpdater({
  container = () => globalThis.navigator?.serviceWorker,
  document: findDocument = () => globalThis.document,
  reload = () => window.location.reload(),
}: UpdaterOptions = {}): UpdateControls {
  const status = createStatus();
  /** The new version's worker. */
  let candidate: WorkerLike | null = null;
  /** Set while this tab is waiting for its own request to take effect. */
  let requested: (() => boolean) | null = null;

  function settle(available: boolean) {
    requested = null;
    status.setState({ available, applying: false });
  }

  function onCandidateChange(worker: WorkerLike) {
    // An older candidate that a newer one replaced.
    if (worker !== candidate) return;
    if (worker.state === 'redundant') {
      candidate = null;
      settle(false);
    } else if (worker.state === 'activated' && requested) {
      // The cashier may have started a sale while the new version was taking over.
      if (requested()) reload();
      else settle(true);
    }
  }

  function offer(worker: WorkerLike, signal: AbortSignal) {
    if (worker === candidate) return;
    candidate = worker;
    worker.addEventListener('statechange', () => onCandidateChange(worker), { signal });
    settle(true);
  }

  /** Waits for an installing worker. Without an active one it is the first install, not news. */
  function watch(registration: RegistrationLike, worker: WorkerLike, signal: AbortSignal) {
    if (registration.active === null) return;
    const check = () => {
      // Another tab may have moved it past `installed` already.
      if (worker.state !== 'installing' && worker.state !== 'redundant') offer(worker, signal);
    };
    worker.addEventListener('statechange', check, { signal });
    check();
  }

  async function register(workers: ContainerLike, signal: AbortSignal): Promise<void> {
    const registration = await workers.register(SERVICE_WORKER_URL);
    if (signal.aborted) return;

    registration.addEventListener(
      'updatefound',
      () => {
        if (registration.installing) watch(registration, registration.installing, signal);
      },
      { signal },
    );
    if (registration.waiting && registration.active) offer(registration.waiting, signal);
    if (registration.installing) watch(registration, registration.installing, signal);

    // Offline this fails, and the next check will do.
    const look = () => void registration.update().catch(() => undefined);
    const timer = setInterval(look, UPDATE_CHECK_MS);
    signal.addEventListener('abort', () => clearInterval(timer));
    const page = findDocument();
    page.addEventListener(
      'visibilitychange',
      () => {
        if (page.visibilityState === 'visible') look();
      },
      { signal },
    );
  }

  return {
    status,
    start() {
      const workers = container();
      if (!workers) return () => undefined;
      const stop = new AbortController();
      register(workers, stop.signal).catch((error: unknown) => {
        // The till works without it; only offline reload and updates are lost.
        console.warn('service worker not registered', (error as Error | null)?.name);
      });
      return () => stop.abort();
    },
    apply(isIdle) {
      if (!candidate || !isIdle()) return;
      // Another tab, or an earlier tap, already switched versions: only this page is behind.
      if (candidate.state === 'activated') {
        reload();
        return;
      }
      if (requested) return;
      requested = isIdle;
      status.setState({ applying: true });
      candidate.postMessage({ type: 'SKIP_WAITING' });
    },
  };
}
