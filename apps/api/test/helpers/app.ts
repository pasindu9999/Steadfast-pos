import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { inject } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../../src/app.setup.js';
import { parseEnv } from '../../src/config/env.js';

export const ALLOWED_ORIGIN = 'http://localhost:5173';

export interface TestAppOptions {
  env?: Record<string, string>;
  /** Extra modules, such as test-only routes. */
  imports?: NonNullable<ModuleMetadata['imports']>;
}

export async function startApp({ env = {}, imports = [] }: TestAppOptions = {}) {
  const config = parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    CORS_ORIGINS: ALLOWED_ORIGIN,
    RATE_LIMIT_PER_MINUTE: '100000',
    ENROL_RATE_LIMIT_PER_MINUTE: '100000',
    ...env,
  });
  const logs: string[] = [];
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config, { write: (line) => void logs.push(line) }), ...imports],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
  configureApp(app, config);
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();

  return {
    logs,
    close: () => app.close(),
    async request(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
      const { token, json, ...rest } = init;
      const headers = new Headers(rest.headers);
      if (token !== undefined) headers.set('authorization', `Bearer ${token}`);
      if (json !== undefined) {
        headers.set('content-type', 'application/json');
        rest.method ??= 'POST';
        rest.body = JSON.stringify(json);
      }
      const response = await fetch(`${url}${path}`, { ...rest, headers });
      const text = await response.text();
      return {
        status: response.status,
        headers: response.headers,
        body: (text === '' ? null : JSON.parse(text)) as unknown,
      };
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof startApp>>;
