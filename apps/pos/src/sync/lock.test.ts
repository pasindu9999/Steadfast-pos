import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemoryLockManager, createSyncLock, SYNC_LOCK } from './lock';

/** A promise the test settles by hand. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.unstubAllGlobals());

describe('createSyncLock', () => {
  it('asks the lock manager for the "sync" lock and returns the result', async () => {
    const manager = createMemoryLockManager();
    const request = vi.spyOn(manager, 'request');

    await expect(createSyncLock(manager).run(() => Promise.resolve(42))).resolves.toBe(42);

    expect(request.mock.calls[0]![0]).toBe(SYNC_LOCK);
    expect(SYNC_LOCK).toBe('sync');
  });

  it('runs one holder at a time, in the order they asked, across "tabs"', async () => {
    const manager = createMemoryLockManager();
    const first = gate();
    const order: string[] = [];

    const a = createSyncLock(manager).run(async () => {
      order.push('a starts');
      await first.opened;
      order.push('a ends');
    });
    const b = createSyncLock(manager).run(() => {
      order.push('b starts');
      return Promise.resolve();
    });
    await tick();
    expect(order).toEqual(['a starts']);

    first.open();
    await Promise.all([a, b]);

    expect(order).toEqual(['a starts', 'a ends', 'b starts']);
  });

  it('releases the lock when the work fails', async () => {
    const lock = createSyncLock(createMemoryLockManager());

    await expect(lock.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    await expect(lock.run(() => Promise.resolve('next'))).resolves.toBe('next');
  });

  it('uses navigator.locks when the browser has it', async () => {
    const request = vi.fn((_: string, work: () => Promise<unknown>) => work());
    vi.stubGlobal('navigator', { locks: { request } });

    await createSyncLock().run(() => Promise.resolve());

    expect(request).toHaveBeenCalledOnce();
  });

  it('falls back to one in-memory queue without navigator.locks', async () => {
    vi.stubGlobal('navigator', {});
    const first = gate();
    let secondStarted = false;

    const a = createSyncLock().run(() => first.opened);
    const b = createSyncLock().run(() => {
      secondStarted = true;
      return Promise.resolve();
    });
    await tick();
    expect(secondStarted).toBe(false);

    first.open();
    await Promise.all([a, b]);
    expect(secondStarted).toBe(true);
  });
});
