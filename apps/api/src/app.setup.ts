import { type NestApplicationOptions, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import type { Env } from './config/env.js';

/** A full batch of 50 large sales is far beyond the default 100 kB. */
const BODY_LIMIT = '5mb';

/** The default body parser is off so that `configureApp` can register one with a larger limit. */
export const APP_OPTIONS: NestApplicationOptions = { bodyParser: false, bufferLogs: true };

/** Shared by `main.ts` and the integration tests. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.useLogger(app.get(Logger));
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.use(helmet());
  app.enableCors({
    origin: env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 600,
  });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  // Every route lives under /v1 (ARCH §8.6).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
}
