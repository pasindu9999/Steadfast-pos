import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyncScheduler } from './scheduler';
import type { CycleOptions, CycleResult } from './sync-cycle';

const ok: CycleResult = { status: 'ok', pulled: true };
const pushed: CycleResult = { status: 'ok', pulled: false };
const retry: CycleResult = { status: 'retry' };
const halted: CycleResult = { status: 'halted', reason: 'UNAUTHORIZED' };

/** A scheduler whose cycles answer with `results`, then succeed. */
function setUp(...results: CycleResult[]) {
  const run = vi.fn((options: CycleOptions) =>
    Promise.resolve(results.shift() ?? (options.pull ? ok : pushed)),
  );
  const scheduler = createSyncScheduler({ run, random: () => 1 });
  const calls = () => run.mock.calls.map(([options]) => options);
  return { run, scheduler, calls };
}

/** A scheduler whose cycles end only when the test says so. */
function setUpSlow() {
  const finish: ((result: CycleResult) => void)[] = [];
  const run = vi.fn<(options: CycleOptions) => Promise<CycleResult>>(
    () =>
      new Promise((resolve) => {
        finish.push(resolve);
      }),
  );
  const scheduler = createSyncScheduler({ run, random: () => 1 });
  /** Ends the oldest cycle still running. */
  const end = async (result: CycleResult = ok) => {
    finish.shift()!(result);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { run, scheduler, end };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('start and the 5 minute pull', () => {
  it('pulls at start-up', async () => {
    const { scheduler, calls } = setUp();

    scheduler.start();
    await advance(0);

    expect(calls()).toEqual([{ pull: true, manual: false }]);
  });

  it('pulls every 5 minutes, and does nothing else on its own', async () => {
    const { scheduler, calls } = setUp();
    scheduler.start();

    await advance(5 * 60_000 - 1);
    expect(calls()).toHaveLength(1);
    await advance(1);
    await advance(5 * 60_000);

    expect(calls()).toEqual(Array.from({ length: 3 }, () => ({ pull: true, manual: false })));
  });

  it('ignores triggers before start', async () => {
    const { scheduler, run } = setUp();

    scheduler.trigger('commit');
    scheduler.setPending(true);
    await advance(60_000);

    expect(run).not.toHaveBeenCalled();
  });
});

describe('triggers', () => {
  it.each(['commit', 'online', 'offline', 'visible'] as const)(
    'pushes without pulling on "%s"',
    async (trigger) => {
      const { scheduler, calls } = setUp();
      scheduler.start();
      await advance(0);

      scheduler.trigger(trigger);
      await advance(0);

      expect(calls()[1]).toEqual({ pull: false, manual: false });
    },
  );

  it('pulls and marks the cycle as manual for "Sync now"', async () => {
    const { scheduler, calls } = setUp();
    scheduler.start();
    await advance(0);

    scheduler.trigger('manual');
    await advance(0);

    expect(calls()[1]).toEqual({ pull: true, manual: true });
  });

  it('runs one cycle at a time, and one more for what arrived meanwhile', async () => {
    const { scheduler, run, end } = setUpSlow();
    scheduler.start();

    scheduler.trigger('commit');
    scheduler.trigger('visible');
    scheduler.trigger('commit');
    expect(run).toHaveBeenCalledTimes(1);

    await end();
    expect(run).toHaveBeenCalledTimes(2);
    await end(pushed);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('the 30 s timer', () => {
  it('runs only while events are pending', async () => {
    const { scheduler, run } = setUp();
    scheduler.start();
    await advance(60_000);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.setPending(true);
    // Saying so again must not restart the timer.
    await advance(20_000);
    scheduler.setPending(true);
    await advance(10_000);
    expect(run).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(run).toHaveBeenCalledTimes(3);

    scheduler.setPending(false);
    await advance(60_000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe('back-off', () => {
  it('doubles from 1 s to 60 s', async () => {
    const { scheduler, run } = setUp(...Array.from({ length: 8 }, () => retry));
    scheduler.start();
    await advance(0);

    for (const [index, seconds] of [1, 2, 4, 8, 16, 32, 60, 60].entries()) {
      await advance(seconds * 1000 - 1);
      expect(run, `before retry ${index + 1}`).toHaveBeenCalledTimes(index + 1);
      await advance(1);
      expect(run, `retry ${index + 1}`).toHaveBeenCalledTimes(index + 2);
    }
    // The last of those succeeded.
    await advance(60_000);
    expect(run).toHaveBeenCalledTimes(9);
  });

  it('starts at 1 s again after a success', async () => {
    const { scheduler, run } = setUp(retry, retry, ok, retry);
    scheduler.start();
    await advance(3_000);
    scheduler.trigger('commit');
    await advance(0);
    expect(run).toHaveBeenCalledTimes(4);

    await advance(1_000);

    expect(run).toHaveBeenCalledTimes(5);
  });

  it('keeps the pull due until one succeeds', async () => {
    const { scheduler, calls } = setUp(retry, retry);
    scheduler.start();
    await advance(3_000);

    expect(calls().map((call) => call.pull)).toEqual([true, true, true]);
    scheduler.trigger('commit');
    await advance(0);
    expect(calls()[3]!.pull).toBe(false);
  });

  it('is not cut short by a commit or by the timers', async () => {
    const { scheduler, run } = setUp(...Array.from({ length: 7 }, () => retry));
    scheduler.start();
    scheduler.setPending(true);
    // 1 + 2 + 4 + 8 + 16 + 32 s of retries, then a 60 s wait.
    await advance(63_000);
    expect(run).toHaveBeenCalledTimes(7);

    scheduler.trigger('commit');
    scheduler.trigger('offline');
    await advance(59_999);
    expect(run).toHaveBeenCalledTimes(7);
    await advance(1);
    expect(run).toHaveBeenCalledTimes(8);
  });

  it('keeps the pull a timer asked for during the wait', async () => {
    const { scheduler, calls } = setUp(pushed, retry);
    scheduler.start();
    await advance(0);
    scheduler.trigger('commit');
    await advance(0);
    scheduler.trigger('pull_timer');
    await advance(1_000);

    expect(calls()[2]).toEqual({ pull: true, manual: false });
  });

  it.each(['online', 'visible', 'manual'] as const)('is cut short by "%s"', async (trigger) => {
    const { scheduler, run } = setUp(retry);
    scheduler.start();
    await advance(0);

    scheduler.trigger(trigger);
    await advance(0);

    expect(run).toHaveBeenCalledTimes(2);
    // The waiting retry was dropped.
    await advance(60_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['online', 1_000],
    ['manual', 1_000],
    ['visible', 4_000],
  ] as const)('after "%s" fails, the next retry is %i ms away', async (trigger, delay) => {
    const { scheduler, run } = setUp(retry, retry, retry);
    scheduler.start();
    await advance(1_000);
    // Two failures so far.
    scheduler.trigger(trigger);
    await advance(delay - 1);
    expect(run).toHaveBeenCalledTimes(3);
    await advance(1);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('runs again at once if the network came back during a failing cycle', async () => {
    const { scheduler, run, end } = setUpSlow();
    scheduler.start();

    scheduler.trigger('online');
    await end(retry);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('waits if only a commit arrived during a failing cycle', async () => {
    const { scheduler, run, end } = setUpSlow();
    scheduler.start();

    scheduler.trigger('commit');
    await end(retry);

    expect(run).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('treats a cycle that threw as a retry', async () => {
    const run = vi
      .fn<(options: CycleOptions) => Promise<CycleResult>>()
      .mockRejectedValueOnce(new Error('database closed'))
      .mockResolvedValue(ok);
    const scheduler = createSyncScheduler({ run, random: () => 1 });
    scheduler.start();

    await advance(1_000);

    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('halted', () => {
  it('stops every timer: no retry loop', async () => {
    const { scheduler, run } = setUp(halted);
    scheduler.start();
    scheduler.setPending(true);
    await advance(0);

    expect(vi.getTimerCount()).toBe(0);
    scheduler.setPending(false);
    scheduler.setPending(true);
    await advance(60 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('resumes the timers once a cycle succeeds again', async () => {
    const { scheduler, run } = setUp(halted);
    scheduler.start();
    scheduler.setPending(true);
    await advance(0);

    scheduler.trigger('manual');
    await advance(30_000);

    expect(run).toHaveBeenCalledTimes(3);
  });

  it('still tries by hand when "Sync now" arrives during the cycle that halted', async () => {
    const { scheduler, run, end } = setUpSlow();
    scheduler.start();

    scheduler.trigger('manual');
    await end(halted);

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0]).toEqual({ pull: true, manual: true });
  });
});

describe('stop', () => {
  it('clears every timer', async () => {
    const { scheduler, run } = setUp(retry);
    scheduler.start();
    scheduler.setPending(true);
    await advance(0);

    scheduler.stop();

    expect(vi.getTimerCount()).toBe(0);
    scheduler.trigger('manual');
    await advance(60 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('schedules nothing when a cycle ends after it', async () => {
    const { scheduler, run, end } = setUpSlow();
    scheduler.start();
    scheduler.trigger('commit');

    scheduler.stop();
    await end(retry);

    expect(vi.getTimerCount()).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('can start again, as React does in development', async () => {
    const { scheduler, run, end } = setUpSlow();
    scheduler.start();
    scheduler.stop();
    scheduler.start();
    expect(run).toHaveBeenCalledTimes(2);

    // The cycle of the first start ends and changes nothing: only the pull timer is running.
    await end(retry);
    expect(vi.getTimerCount()).toBe(1);
    await end();
    expect(vi.getTimerCount()).toBe(1);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
