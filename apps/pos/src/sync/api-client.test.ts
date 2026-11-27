import { describe, expect, it, vi } from 'vitest';

import { DEVICE_TOKEN, enrolFixture, fakeFetch, TERMINAL_ID } from '../test/api-fixtures';
import { storeFixture } from '../test/fixtures';
import { ApiRequestError, createApiClient } from './api-client';

const BASE = 'https://api.test';

const client = (fetchFn: typeof fetch, timeoutMs?: number) =>
  createApiClient({ baseUrl: BASE, fetchFn, timeoutMs });

const emptyPull = {
  store: storeFixture,
  products: [],
  variants: [],
  staff: [],
  inventory: [],
  nextCursor: 'cursor-1',
  lastAppliedSeq: 0,
};

/** The request a fake `fetch` received. */
function sent(fetchFn: ReturnType<typeof fakeFetch>) {
  const [url, init] = fetchFn.mock.calls[0]!;
  return { url, init: init!, headers: new Headers(init!.headers) };
}

async function failure(promise: Promise<unknown>): Promise<ApiRequestError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

describe('enrol', () => {
  it('posts the code as JSON to /v1/terminals/enrol', async () => {
    const fetchFn = fakeFetch(200, enrolFixture);

    await client(fetchFn).enrol('DEMO-CODE-T1');

    const { url, init, headers } = sent(fetchFn);
    expect(url).toBe('https://api.test/v1/terminals/enrol');
    expect(init.method).toBe('POST');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
    expect(JSON.parse(init.body as string)).toEqual({ enrolmentCode: 'DEMO-CODE-T1' });
  });

  it('returns the response parsed by the shared contract', async () => {
    const fetchFn = fakeFetch(200, {
      ...enrolFixture,
      terminalId: TERMINAL_ID.toUpperCase(),
      unexpected: 'dropped',
    });

    expect(await client(fetchFn).enrol('DEMO-CODE-T1')).toEqual(enrolFixture);
  });

  it.each([
    ['a missing field', { ...enrolFixture, receiptSeq: undefined }],
    ['a negative counter', { ...enrolFixture, lastAppliedSeq: -1 }],
    ['a captive-portal page', '<html>Sign in to Wi-Fi</html>'],
    ['an empty body', ''],
  ])('refuses %s as an invalid response', async (_, body) => {
    const error = await failure(client(fakeFetch(200, body)).enrol('DEMO-CODE-T1'));

    expect(error).toMatchObject({ kind: 'invalid_response', status: 200, code: null });
  });

  it.each([
    [401, 'INVALID_ENROLMENT_CODE'],
    [429, 'RATE_LIMITED'],
    [500, 'INTERNAL_ERROR'],
  ])('reports HTTP %i with the API error code', async (status, code) => {
    const fetchFn = fakeFetch(status, { error: { code, message: 'No' } });

    const error = await failure(client(fetchFn).enrol('DEMO-CODE-T1'));

    expect(error).toMatchObject({ kind: 'http', status, code });
  });

  it('reports an HTTP error whose body is not the API error shape', async () => {
    const error = await failure(client(fakeFetch(502, 'Bad gateway')).enrol('DEMO-CODE-T1'));

    expect(error).toMatchObject({ kind: 'http', status: 502, code: null });
  });

  it('reports a network failure', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')));

    const error = await failure(client(fetchFn).enrol('DEMO-CODE-T1'));

    expect(error).toMatchObject({ kind: 'network', status: null, code: null });
  });

  it('gives up after the timeout', async () => {
    const hanging = vi.fn<typeof fetch>(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const error = await failure(client(hanging, 5).enrol('DEMO-CODE-T1'));

    expect(error.kind).toBe('network');
  });
});

describe('pull', () => {
  it('sends the device token and no cursor on the first pull', async () => {
    const fetchFn = fakeFetch(200, emptyPull);

    await client(fetchFn).pull(DEVICE_TOKEN);

    const { url, init, headers } = sent(fetchFn);
    expect(url).toBe('https://api.test/v1/sync/pull');
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect(headers.get('authorization')).toBe(`Bearer ${DEVICE_TOKEN}`);
  });

  it('URL-encodes the cursor', async () => {
    const fetchFn = fakeFetch(200, emptyPull);

    await client(fetchFn).pull(DEVICE_TOKEN, 'a b&c=d');

    expect(sent(fetchFn).url).toBe('https://api.test/v1/sync/pull?cursor=a+b%26c%3Dd');
  });

  it('refuses a response that breaks the pull contract', async () => {
    const fetchFn = fakeFetch(200, { ...emptyPull, nextCursor: '' });

    const error = await failure(client(fetchFn).pull(DEVICE_TOKEN));

    expect(error.kind).toBe('invalid_response');
  });

  it('never puts the token or the response body in the error', async () => {
    const fetchFn = fakeFetch(401, {
      error: { code: 'UNAUTHORIZED', message: `bad token ${DEVICE_TOKEN}` },
    });

    const error = await failure(client(fetchFn).pull(DEVICE_TOKEN));

    expect(`${error.message} ${error.stack} ${JSON.stringify(error)}`).not.toContain(DEVICE_TOKEN);
  });

  it('uses the global fetch when none is given', async () => {
    const fetchFn = fakeFetch(200, emptyPull);
    vi.stubGlobal('fetch', fetchFn);

    await createApiClient({ baseUrl: BASE }).pull(DEVICE_TOKEN);

    expect(fetchFn).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
