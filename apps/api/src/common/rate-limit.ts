import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

import type { Env } from '../config/env.js';

const STRICT = 'rate-limit:strict';

/** For endpoints where each call is a guess at a secret. */
export const StrictRateLimit = () => SetMetadata(STRICT, true);

export function rateLimitOptions(env: Env): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        ttl: 60_000,
        limit: (context: ExecutionContext) =>
          Reflect.getMetadata(STRICT, context.getHandler())
            ? env.ENROL_RATE_LIMIT_PER_MINUTE
            : env.RATE_LIMIT_PER_MINUTE,
      },
    ],
  };
}
