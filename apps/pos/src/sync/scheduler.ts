/**
 * Decides when a sync cycle runs (ARCH §4.7): one at a time in this tab, with a 30 s timer while
 * events are pending, a pull every 5 minutes, and back-off after a failure. A halt stops every
 * timer, so nothing retries by itself.
 */
import { backoffDelayMs } from './backoff';
import type { CycleOptions, CycleResult } from './sync-cycle';

export const PENDING_INTERVAL_MS = 30_000;
export const PULL_INTERVAL_MS = 5 * 60_000;

export type SyncTrigger =
  | 'startup'
  | 'commit'
  | 'online'
  | 'offline'
  | 'visible'
  | 'retry'
  | 'pending_timer'
  | 'pull_timer'
  | 'manual';

const PULLS: ReadonlySet<SyncTrigger> = new Set(['startup', 'pull_timer', 'manual']);
/** Signs that trying now may work, so they don't wait for the back-off. */
const URGENT: ReadonlySet<SyncTrigger> = new Set(['online', 'visible', 'manual', 'retry']);
/** The network or the person says things have changed: back-off starts again. */
const RESETS: ReadonlySet<SyncTrigger> = new Set(['online', 'manual']);

export interface SchedulerOptions {
  run: (options: CycleOptions) => Promise<CycleResult>;
  random?: () => number;
}

export interface SyncScheduler {
  start: () => void;
  stop: () => void;
  trigger: (trigger: SyncTrigger) => void;
  /** Whether the outbox holds unsent events. */
  setPending: (pending: boolean) => void;
}

type Timer = ReturnType<typeof setTimeout>;

export function createSyncScheduler({ run, random }: SchedulerOptions): SyncScheduler {
  let started = false;
  /** Raised by `stop`, so a cycle that ends afterwards changes nothing. */
  let generation = 0;
  let running = false;
  /** A trigger arrived while running. */
  let again = false;
  let urgent = false;
  let pullDue = false;
  let manualDue = false;
  let halted = false;
  let pending = false;
  let failures = 0;
  let retryTimer: Timer | undefined;
  let pendingTimer: Timer | undefined;
  let pullTimer: Timer | undefined;

  function updateTimers(): void {
    const active = started && !halted;
    if (active && pending) {
      pendingTimer ??= setInterval(() => trigger('pending_timer'), PENDING_INTERVAL_MS);
    } else {
      clearInterval(pendingTimer);
      pendingTimer = undefined;
    }
    if (active) {
      pullTimer ??= setInterval(() => trigger('pull_timer'), PULL_INTERVAL_MS);
    } else {
      clearInterval(pullTimer);
      pullTimer = undefined;
    }
  }

  function clearRetry(): void {
    clearTimeout(retryTimer);
    retryTimer = undefined;
  }

  function waitThenRetry(): void {
    failures += 1;
    retryTimer = setTimeout(
      () => {
        retryTimer = undefined;
        trigger('retry');
      },
      backoffDelayMs(failures, random),
    );
  }

  async function runCycles(): Promise<void> {
    const mine = generation;
    running = true;
    do {
      const options: CycleOptions = { pull: pullDue, manual: manualDue };
      pullDue = manualDue = again = urgent = false;

      const result = await run(options).catch((): CycleResult => ({ status: 'retry' }));
      if (mine !== generation) return;

      // A pull that did not happen is still due.
      if (options.pull && !(result.status === 'ok' && result.pulled)) pullDue = true;
      if (result.status === 'ok') {
        failures = 0;
        halted = false;
      } else if (result.status === 'halted') {
        halted = true;
        // Only a person's request is worth another cycle.
        again = manualDue;
      } else if (result.status === 'retry' && !urgent) {
        again = false;
        waitThenRetry();
      }
      updateTimers();
    } while (again);
    running = false;
  }

  function trigger(reason: SyncTrigger): void {
    if (!started) return;
    if (PULLS.has(reason)) pullDue = true;
    if (reason === 'manual') manualDue = true;
    if (RESETS.has(reason)) failures = 0;
    if (retryTimer !== undefined) {
      if (!URGENT.has(reason)) return;
      clearRetry();
    }
    if (running) {
      again = true;
      urgent ||= URGENT.has(reason);
      return;
    }
    void runCycles();
  }

  return {
    start() {
      if (started) return;
      started = true;
      halted = false;
      failures = 0;
      updateTimers();
      trigger('startup');
    },
    stop() {
      started = false;
      generation += 1;
      running = again = urgent = pullDue = manualDue = false;
      pending = false;
      clearRetry();
      updateTimers();
    },
    trigger,
    setPending(value) {
      pending = value;
      updateTimers();
    },
  };
}
