import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';

import type { Env } from '../config/env.js';

interface LoggedRequest {
  id: unknown;
  method: string;
  url: string;
}

/** No headers, bodies or client addresses reach the logs (ARCH §11). */
export function loggerOptions(env: Env, destination?: DestinationStream): Params {
  const options = {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: {
      req: ({ id, method, url }: LoggedRequest) => ({ id, method, url }),
      res: ({ statusCode }: { statusCode: number }) => ({ statusCode }),
    },
    autoLogging: { ignore: (request: { url?: string }) => request.url === '/v1/health' },
  };
  return { pinoHttp: destination ? [options, destination] : options };
}
