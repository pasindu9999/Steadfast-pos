import type { ErrorCode } from '@pos/core';

/** An error the client may see. `extra` is added next to `error` in the response body. */
export class ApiException extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
  }
}
