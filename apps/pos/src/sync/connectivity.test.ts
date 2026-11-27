import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeFetch } from '../test/api-fixtures';
import { createApiClient } from './api-client';
import { checkHealth } from './connectivity';

const client = (fetchFn: typeof fetch) => createApiClient({ baseUrl: 'https://api.test', fetchFn });

/** A request that ends only when it is aborted. */
const hanging = () =>
  vi.fn<typeof fetch>(
    (_, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );

afterEach(() => vi.useRealTimers());

describe('checkHealth', () => {
  it('asks /v1/health without a token', async () => {
    const fetchFn = fakeFetch(200, { status: 'ok' });

    await expect(checkHealth(client(fetchFn))).resolves.toBe(true);

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.test/v1/health');
    expect(new Headers(init!.headers).has('authorization')).toBe(false);
    expect(init!.cache).toBe('no-store');
  });

  it.each([
    ['a captive-portal page', 200, '<html>Sign in to Wi-Fi</html>'],
    ['another JSON answer', 200, { ok: true }],
    ['a server error', 500, { error: { code: 'INTERNAL_ERROR', message: 'x' } }],
  ])('is false for %s', async (_, status, body) => {
    await expect(checkHealth(client(fakeFetch(status, body)))).resolves.toBe(false);
  });

  it('is false when the network fails', async () => {
    const offline = () => Promise.reject(new TypeError('Failed to fetch'));

    await expect(checkHealth(client(offline))).resolves.toBe(false);
  });

  it('gives up after 3 seconds, aborting the request', async () => {
    vi.useFakeTimers();
    const fetchFn = hanging();
    let answer: boolean | undefined;
    void checkHealth(client(fetchFn)).then((healthy) => {
      answer = healthy;
    });

    await vi.advanceTimersByTimeAsync(2_999);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);

    expect(answer).toBe(false);
    expect(fetchFn.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
