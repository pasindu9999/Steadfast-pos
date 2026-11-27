import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import { apiErrorSchema } from '@pos/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALLOWED_ORIGIN, startApp, type TestApp } from './helpers/app.js';

@Controller('probe')
class ProbeController {
  @Get('boom')
  boom(): never {
    throw new Error('internal detail: password=hunter2');
  }

  @Post('echo')
  echo(@Body() body: { filler?: string }) {
    return { length: body.filler?.length ?? 0 };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;

describe('HTTP baseline', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp({ imports: [ProbeModule], env: { LOG_LEVEL: 'info' } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the health check', async () => {
    const response = await app.request('/v1/health');

    expect(response).toMatchObject({ status: 200, body: { status: 'ok' } });
  });

  it('sets security headers and hides the framework', async () => {
    const { headers } = await app.request('/v1/health');

    expect(headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(headers.get('strict-transport-security')).toContain('max-age=');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('x-powered-by')).toBeNull();
  });

  const preflight = (origin: string) =>
    app.request('/v1/sync/push', {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

  it('allows the POS origin', async () => {
    const { status, headers } = await preflight(ALLOWED_ORIGIN);

    expect(status).toBe(204);
    expect(headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });

  it('gives other origins no CORS permission', async () => {
    const { headers } = await preflight('https://evil.example.com');

    expect(headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each(['/v1/nope', '/nope', '/health'])('answers %s with NOT_FOUND', async (path) => {
    const response = await app.request(path);

    expect(response.status).toBe(404);
    expect(errorCode(response.body)).toBe('NOT_FOUND');
  });

  it('answers malformed JSON with VALIDATION_FAILED without echoing it', async () => {
    const response = await app.request('/v1/probe/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"cardLast4": 4242 oops',
    });

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response.body)).not.toContain('4242');
  });

  it('accepts a 1 MB body, which a full push batch can reach', async () => {
    const response = await app.request('/v1/probe/echo', {
      json: { filler: 'x'.repeat(1024 * 1024) },
    });

    expect(response).toMatchObject({ status: 201, body: { length: 1024 * 1024 } });
  });

  it('refuses a body over 5 MB with PAYLOAD_TOO_LARGE', async () => {
    const response = await app.request('/v1/probe/echo', {
      json: { filler: 'x'.repeat(6 * 1024 * 1024) },
    });

    expect(response.status).toBe(413);
    expect(errorCode(response.body)).toBe('PAYLOAD_TOO_LARGE');
  });

  it('hides the details of an unexpected error', async () => {
    const response = await app.request('/v1/probe/boom');

    expect(response.status).toBe(500);
    expect(errorCode(response.body)).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('logs requests without headers or client addresses', async () => {
    app.logs.length = 0;

    await app.request('/v1/probe/boom', { token: 'very-secret-device-token' });

    await expect.poll(() => app.logs.join('')).toContain('/v1/probe/boom');
    const output = app.logs.join('');
    expect(output).not.toContain('very-secret-device-token');
    expect(output).not.toContain('127.0.0.1');
  });
});

describe('rate limiting', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startApp({ imports: [ProbeModule], env: { RATE_LIMIT_PER_MINUTE: '3' } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers RATE_LIMITED above the limit but never limits the health check', async () => {
    const echo = () => app.request('/v1/probe/echo', { json: {} });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await echo()).status).toBe(201);
    }

    const limited = await echo();

    expect(limited.status).toBe(429);
    expect(errorCode(limited.body)).toBe('RATE_LIMITED');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await app.request('/v1/health')).status).toBe(200);
    }
  });
});

describe('health check without a database', () => {
  it('still answers, so it never wakes the database (ARCH §4.7)', async () => {
    const app = await startApp({
      env: { DATABASE_URL: 'postgresql://pos:pos@127.0.0.1:1/unreachable' },
    });

    expect((await app.request('/v1/health')).status).toBe(200);

    await app.close();
  });
});
