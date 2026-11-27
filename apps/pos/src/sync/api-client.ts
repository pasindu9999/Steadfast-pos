/**
 * The only code in the terminal that calls `fetch` (CLAUDE.md rule 1). Checkout never imports it.
 * Every response is parsed with the shared contracts before anything uses it.
 */
import {
  apiErrorSchema,
  type EnrolResponse,
  enrolResponseSchema,
  type PullResponse,
  pullResponseSchema,
} from '@pos/core';

/** Long enough for a sleeping server to wake and for a first catalogue download. */
const DEFAULT_TIMEOUT_MS = 60_000;

/** `network` covers offline, timeouts and refused connections. */
export type ApiFailureKind = 'network' | 'http' | 'invalid_response';

/** Carries no body and no headers, so it is safe to log. */
export class ApiRequestError extends Error {
  override readonly name = 'ApiRequestError';

  constructor(
    readonly kind: ApiFailureKind,
    readonly status: number | null = null,
    /** The API's error code, when it sent one. */
    readonly code: string | null = null,
  ) {
    super(`API request failed: ${[kind, status, code].filter((part) => part !== null).join(' ')}`);
  }
}

export interface ApiClientOptions {
  /** Without `/v1`, as returned by `normaliseApiUrl`. */
  baseUrl: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface ApiClient {
  enrol(enrolmentCode: string): Promise<EnrolResponse>;
  /** Omit the cursor for the first, full pull. */
  pull(deviceToken: string, cursor?: string): Promise<PullResponse>;
}

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createApiClient({
  baseUrl,
  fetchFn = (input, init) => fetch(input, init),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ApiClientOptions): ApiClient {
  async function request<T>(path: string, schema: Schema<T>, init: RequestInit): Promise<T> {
    let response: Response;
    let text: string;
    try {
      response = await fetchFn(`${baseUrl}/v1${path}`, {
        ...init,
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await response.text();
    } catch {
      throw new ApiRequestError('network');
    }

    const body = parseJson(text);
    if (!response.ok) {
      const failure = apiErrorSchema.safeParse(body);
      const code = failure.success ? failure.data.error.code : null;
      throw new ApiRequestError('http', response.status, code);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ApiRequestError('invalid_response', response.status);
    return parsed.data;
  }

  return {
    enrol: (enrolmentCode) =>
      request('/terminals/enrol', enrolResponseSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enrolmentCode }),
      }),
    pull: (deviceToken, cursor) => {
      const query = cursor === undefined ? '' : `?${new URLSearchParams({ cursor }).toString()}`;
      return request(`/sync/pull${query}`, pullResponseSchema, {
        method: 'GET',
        headers: { authorization: `Bearer ${deviceToken}` },
      });
    },
  };
}
