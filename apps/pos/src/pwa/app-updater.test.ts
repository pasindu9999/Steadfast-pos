import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fakeContainer,
  fakeDocument,
  FakeRegistration,
  FakeWorker,
} from '../test/fake-service-worker';
import { createAppUpdater, UPDATE_CHECK_MS } from './app-updater';

beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const idle = () => true;
const busy = () => false;
/** Lets the registration promise resolve. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function startUpdater(registration = FakeRegistration.running()) {
  const container = fakeContainer(registration);
  const document = fakeDocument();
  const reload = vi.fn();
  const updater = createAppUpdater({
    container: () => container,
    document: () => document,
    reload,
  });
  const stop = updater.start();
  await settle();
  const state = () => updater.status.getState();
  return { updater, registration, container, document, reload, stop, state };
}

/** A till with a new version waiting. */
async function withUpdate() {
  const till = await startUpdater();
  const worker = till.registration.find();
  till.registration.installed(worker);
  return { ...till, worker };
}

describe('finding an update', () => {
  it('registers the service worker', async () => {
    const { container, state } = await startUpdater();

    expect(container.registered).toEqual(['/sw.js']);
    expect(state()).toEqual({ available: false, applying: false });
  });

  it('does not call the first install an update', async () => {
    const registration = new FakeRegistration();
    const { state } = await startUpdater(registration);

    const worker = registration.find();
    registration.installed(worker);
    registration.activate(worker);

    expect(state().available).toBe(false);
  });

  it('does not call a first install already under way an update', async () => {
    const registration = new FakeRegistration();
    const worker = new FakeWorker('installing');
    registration.installing = worker;
    const { state } = await startUpdater(registration);

    registration.installed(worker);

    expect(state().available).toBe(false);
  });

  it('offers a new version once it has installed', async () => {
    const { registration, state } = await startUpdater();

    const worker = registration.find();
    expect(state().available).toBe(false);
    registration.installed(worker);

    expect(state().available).toBe(true);
  });

  it('offers a version that was already waiting at start-up', async () => {
    const registration = FakeRegistration.running();
    registration.waiting = new FakeWorker('installed');

    const { state } = await startUpdater(registration);

    expect(state().available).toBe(true);
  });

  it('offers a version that was already installing at start-up', async () => {
    const registration = FakeRegistration.running();
    const worker = new FakeWorker('installing');
    registration.installing = worker;
    const { state } = await startUpdater(registration);

    registration.installed(worker);

    expect(state().available).toBe(true);
  });

  it('withdraws an update that failed', async () => {
    const { worker, state } = await withUpdate();

    worker.become('redundant');

    expect(state().available).toBe(false);
  });

  it('keeps offering the newer of two waiting versions', async () => {
    const { registration, worker, updater, state } = await withUpdate();

    const newer = registration.find();
    registration.installed(newer);
    worker.become('redundant');
    updater.apply(idle);

    expect(state().available).toBe(true);
    expect(newer.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(worker.messages).toEqual([]);
  });
});

describe('applying an update', () => {
  it('never reloads on its own', async () => {
    const { worker, reload } = await withUpdate();

    expect(worker.messages).toEqual([]);
    expect(reload).not.toHaveBeenCalled();
  });

  it('tells the new version to take over, then reloads', async () => {
    const { updater, registration, worker, reload, state } = await withUpdate();

    updater.apply(idle);
    expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(state().applying).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    registration.activate(worker);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('asks only once, however often it is tapped', async () => {
    const { updater, registration, worker, reload } = await withUpdate();

    updater.apply(idle);
    updater.apply(idle);
    registration.activate(worker);

    expect(worker.messages).toHaveLength(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the till is busy', async () => {
    const { updater, worker, reload, state } = await withUpdate();

    updater.apply(busy);

    expect(worker.messages).toEqual([]);
    expect(state()).toEqual({ available: true, applying: false });
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing without an update', async () => {
    const { updater, reload } = await startUpdater();

    updater.apply(idle);

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload if a sale started while the new version took over', async () => {
    const { updater, registration, worker, reload, state } = await withUpdate();
    let free = true;

    updater.apply(() => free);
    free = false;
    registration.activate(worker);

    expect(reload).not.toHaveBeenCalled();
    expect(state()).toEqual({ available: true, applying: false });

    // The next tap, between sales, only needs to reload.
    free = true;
    updater.apply(() => free);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(worker.messages).toHaveLength(1);
  });
});

describe('another tab applying the update', () => {
  it('does not reload this one, even when it is idle', async () => {
    const { registration, worker, reload, state } = await withUpdate();

    registration.activate(worker);

    expect(reload).not.toHaveBeenCalled();
    expect(state()).toEqual({ available: true, applying: false });
  });

  it('lets this one reload with a tap, once it is idle', async () => {
    const { updater, registration, worker, reload } = await withUpdate();
    registration.activate(worker);

    updater.apply(busy);
    expect(reload).not.toHaveBeenCalled();
    updater.apply(idle);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(worker.messages).toEqual([]);
  });

  it('is noticed even if it takes over before this tab sees it installed', async () => {
    const { registration, reload, state } = await startUpdater();

    const worker = registration.find();
    registration.activate(worker);

    expect(state().available).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('looking for updates', () => {
  it('checks every hour', async () => {
    const { registration } = await startUpdater();

    vi.advanceTimersByTime(UPDATE_CHECK_MS * 2);

    expect(registration.checks).toBe(2);
  });

  it('checks when the till comes back into view', async () => {
    const { registration, document } = await startUpdater();

    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.checks).toBe(0);
    document.visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));

    expect(registration.checks).toBe(1);
  });

  it('carries on when a check fails offline', async () => {
    const { registration, state } = await startUpdater();
    registration.checkResult = () => Promise.reject(new TypeError('offline'));

    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    await settle();
    vi.advanceTimersByTime(UPDATE_CHECK_MS);

    expect(registration.checks).toBe(2);
    expect(state().available).toBe(false);
  });
});

describe('without a service worker', () => {
  it('does nothing in a browser that has none', async () => {
    const reload = vi.fn();
    const updater = createAppUpdater({ container: () => undefined, reload });

    const stop = updater.start();
    await settle();
    updater.apply(idle);
    stop();

    expect(updater.status.getState().available).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('carries on when registration is refused, logging only the kind', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const updater = createAppUpdater({
      container: () => ({
        register: () => Promise.reject(new DOMException('secret detail', 'SecurityError')),
      }),
      document: () => fakeDocument(),
    });

    updater.start();
    await settle();

    expect(updater.status.getState().available).toBe(false);
    expect(warn).toHaveBeenCalledWith('service worker not registered', 'SecurityError');
  });
});

describe('stopping', () => {
  it('removes its timer and listeners', async () => {
    const { registration, document, stop, state } = await startUpdater();

    stop();
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    registration.installed(registration.find());

    expect(registration.checks).toBe(0);
    expect(state().available).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sets nothing up if stopped before registration finished', async () => {
    const registration = FakeRegistration.running();
    const updater = createAppUpdater({
      container: () => fakeContainer(registration),
      document: () => fakeDocument(),
    });

    updater.start()();
    await settle();

    expect(vi.getTimerCount()).toBe(0);
  });
});
