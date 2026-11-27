import { afterEach, describe, expect, it, vi } from 'vitest';

import { browserTargets } from '../test/browser-targets';
import { sell, terminalWithSales } from '../test/sync-fixtures';
import { watchBrowser, watchOutbox } from './triggers';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('watchBrowser', () => {
  it('reports the network events and the page becoming visible', () => {
    const targets = browserTargets();
    const triggered = vi.fn();
    watchBrowser(targets, triggered);

    targets.window.dispatchEvent(new Event('online'));
    targets.window.dispatchEvent(new Event('offline'));
    targets.document.dispatchEvent(new Event('visibilitychange'));

    expect(triggered.mock.calls).toEqual([['online'], ['offline'], ['visible']]);
  });

  it('ignores the page being hidden', () => {
    const targets = browserTargets();
    const triggered = vi.fn();
    watchBrowser(targets, triggered);

    targets.document.visibilityState = 'hidden';
    targets.document.dispatchEvent(new Event('visibilitychange'));

    expect(triggered).not.toHaveBeenCalled();
  });

  it('removes its listeners', () => {
    const targets = browserTargets();
    const triggered = vi.fn();

    watchBrowser(targets, triggered)();
    targets.window.dispatchEvent(new Event('online'));
    targets.window.dispatchEvent(new Event('offline'));
    targets.document.dispatchEvent(new Event('visibilitychange'));

    expect(triggered).not.toHaveBeenCalled();
  });
});

describe('watchOutbox', () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
  });

  async function watch(sales = 0) {
    const database = await terminalWithSales(sales);
    const commits: number[] = [];
    const onPending = vi.fn<(pending: boolean) => void>();
    const stop = watchOutbox(database, {
      onCommit: () => commits.push(Date.now()),
      onPending,
    });
    stops.push(stop);
    await vi.waitFor(() => expect(onPending).toHaveBeenCalled());
    return { database, commits, onPending, stop };
  }

  it('says whether anything is waiting to be sent', async () => {
    const { database, onPending } = await watch();
    expect(onPending).toHaveBeenLastCalledWith(false);

    await sell(database);
    await vi.waitFor(() => expect(onPending).toHaveBeenLastCalledWith(true));

    await database.outbox.toCollection().modify({ status: 'synced' });
    await vi.waitFor(() => expect(onPending).toHaveBeenLastCalledWith(false));
  });

  it('reports a burst of commits once, 500 ms after the last', async () => {
    const { database, commits } = await watch();

    await sell(database, 3);
    const committed = Date.now();

    await vi.waitFor(() => expect(commits).toHaveLength(1), { timeout: 2_000 });
    // A little under 500 allows for timer rounding.
    expect(commits[0]! - committed).toBeGreaterThanOrEqual(450);
    await pause(700);
    expect(commits).toHaveLength(1);
  });

  it('does not report what was already waiting, or events being marked synced', async () => {
    const { database, commits } = await watch(2);

    await database.outbox.where('seq').equals(1).modify({ status: 'synced' });
    await database.outbox.where('seq').equals(2).modify({ status: 'synced' });
    await pause(700);

    expect(commits).toEqual([]);
  });

  it('reports a sale made after everything was sent', async () => {
    const { database, commits } = await watch(1);
    await database.outbox.toCollection().modify({ status: 'synced' });

    await sell(database);

    await vi.waitFor(() => expect(commits).toHaveLength(1), { timeout: 2_000 });
  });

  it('is silent once stopped, even with a report waiting', async () => {
    const { database, commits, onPending, stop } = await watch();
    await sell(database);
    await vi.waitFor(() => expect(onPending).toHaveBeenLastCalledWith(true));

    stop();
    onPending.mockClear();
    await sell(database);
    await pause(700);

    expect(commits).toEqual([]);
    expect(onPending).not.toHaveBeenCalled();
  });
});
