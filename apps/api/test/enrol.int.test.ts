import { createHash } from 'node:crypto';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { apiErrorSchema, enrolResponseSchema } from '@pos/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/generated/prisma/client.js';
import { CurrentTerminal } from '../src/modules/terminals/current-terminal.decorator.js';
import {
  type AuthenticatedTerminal,
  DeviceAuthGuard,
} from '../src/modules/terminals/device-auth.guard.js';
import { hashEnrolmentCode } from '../src/modules/terminals/enrolment-code.js';
import { startApp, type TestApp } from './helpers/app.js';
import { createCatalogue, resetDb, testPrisma } from './helpers/db.js';

@Controller('probe')
@UseGuards(DeviceAuthGuard)
class ProbeController {
  @Get('me')
  me(@CurrentTerminal() terminal: AuthenticatedTerminal) {
    return terminal;
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const CODE = 'ABCD-1234';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let prisma: PrismaClient;
let app: TestApp;
let fixtures: Awaited<ReturnType<typeof createCatalogue>>;

beforeAll(async () => {
  prisma = testPrisma();
  app = await startApp({ imports: [ProbeModule] });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDb(prisma);
  fixtures = await createCatalogue(prisma);
  await updateTerminal({ enrolmentCodeHash: hashEnrolmentCode(CODE) });
});

const updateTerminal = (data: Parameters<PrismaClient['terminal']['update']>[0]['data']) =>
  prisma.terminal.update({ where: { id: fixtures.terminal.id }, data });

const terminalRow = () =>
  prisma.terminal.findUniqueOrThrow({ where: { id: fixtures.terminal.id } });

const enrol = (enrolmentCode: unknown = CODE, target = app) =>
  target.request('/v1/terminals/enrol', { json: { enrolmentCode } });

const enrolledToken = async () => {
  const response = await enrol();
  expect(response.status).toBe(200);
  return enrolResponseSchema.parse(response.body).deviceToken;
};

const errorCode = (body: unknown) => apiErrorSchema.parse(body).error.code;

describe('POST /v1/terminals/enrol', () => {
  it('exchanges a code for a device token', async () => {
    const response = await enrol();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = enrolResponseSchema.parse(response.body);
    expect(body).toMatchObject({
      terminalId: fixtures.terminal.id,
      terminalCode: 'T1',
      lastAppliedSeq: 0,
      receiptSeq: 0,
      returnSeq: 0,
    });
    // 256 random bits (ARCH §11).
    expect(Buffer.from(body.deviceToken, 'base64url')).toHaveLength(32);
  });

  it('stores only hashes', async () => {
    const token = await enrolledToken();

    const row = await terminalRow();
    expect(row.deviceTokenHash).toBe(sha256(token));
    expect(row.enrolmentCodeUsedAt).toBeInstanceOf(Date);
    const stored = JSON.stringify(row, (_, value: unknown) => String(value));
    expect(stored).not.toContain(token);
    expect(Object.values(row).map(String)).not.toContain(CODE);
  });

  it('ignores case and spaces in a typed code', async () => {
    expect((await enrol('  abcd-12 34 ')).status).toBe(200);
  });

  it('answers 401 for an unknown code and changes nothing', async () => {
    const response = await enrol('WRONG-CODE');

    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('INVALID_ENROLMENT_CODE');
    expect((await terminalRow()).deviceTokenHash).toBeNull();
  });

  it.each([undefined, 12345678, 'short', 'x'.repeat(65)])('answers 400 for %o', async (code) => {
    const response = await enrol(code === undefined ? null : code);

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_FAILED');
  });

  it('answers 400 without a body', async () => {
    const response = await app.request('/v1/terminals/enrol', { method: 'POST' });

    expect(response.status).toBe(400);
  });

  it('accepts a single-use code once and keeps the first token valid', async () => {
    const token = await enrolledToken();

    const second = await enrol();

    expect(second.status).toBe(401);
    expect(errorCode(second.body)).toBe('INVALID_ENROLMENT_CODE');
    expect((await app.request('/v1/probe/me', { token })).status).toBe(200);
  });

  it('treats a demo code as single-use outside demo mode (ARCH §11)', async () => {
    await updateTerminal({ enrolmentCodeReusable: true });
    const token = await enrolledToken();

    const second = await enrol();

    expect(second.status).toBe(401);
    expect(errorCode(second.body)).toBe('INVALID_ENROLMENT_CODE');
    expect((await app.request('/v1/probe/me', { token })).status).toBe(200);
  });

  it('returns the counter high-water marks on enrolment (ARCH §4.3)', async () => {
    await updateTerminal({ lastAppliedSeq: 41, receiptSeq: 123, returnSeq: 17 });

    const response = await enrol();

    expect(response.body).toMatchObject({ lastAppliedSeq: 41, receiptSeq: 123, returnSeq: 17 });
  });

  it('answers 401 for a deactivated terminal', async () => {
    await updateTerminal({ isActive: false });

    expect((await enrol()).status).toBe(401);
  });

  it('redeems a single-use code once when requests race', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => enrol()));

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 401, 401, 401, 401, 401, 401, 401]);
    const winner = responses.find((response) => response.status === 200);
    const { deviceToken } = enrolResponseSchema.parse(winner?.body);
    expect((await terminalRow()).deviceTokenHash).toBe(sha256(deviceToken));
  });

  it('never logs the code or the token', async () => {
    app.logs.length = 0;
    const token = await enrolledToken();

    await expect.poll(() => app.logs.join('')).toContain(fixtures.terminal.id);

    expect(app.logs.join('')).not.toContain(token);
    expect(app.logs.join('')).not.toContain(CODE);
  });

  it('is rate limited more strictly than other routes', async () => {
    const limited = await startApp({
      imports: [ProbeModule],
      env: { ENROL_RATE_LIMIT_PER_MINUTE: '2' },
    });

    expect((await enrol('WRONG-CODE', limited)).status).toBe(401);
    expect((await enrol('WRONG-CODE', limited)).status).toBe(401);
    const third = await enrol(CODE, limited);

    expect(third.status).toBe(429);
    expect(errorCode(third.body)).toBe('RATE_LIMITED');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await limited.request('/v1/probe/me')).status).toBe(401);
    }
    await limited.close();
  });
});

describe('demo mode (ARCH §11)', () => {
  let demo: TestApp;

  beforeAll(async () => {
    demo = await startApp({ imports: [ProbeModule], env: { DEMO_MODE: 'true' } });
  });

  afterAll(async () => {
    await demo.close();
  });

  const enrolDemo = async () => {
    const response = await enrol(CODE, demo);
    expect(response.status).toBe(200);
    return enrolResponseSchema.parse(response.body);
  };
  const meWith = async (token: string) => (await demo.request('/v1/probe/me', { token })).status;

  it('lets a demo code enrol again and again, replacing the old token', async () => {
    await updateTerminal({ enrolmentCodeReusable: true });

    const tokens: string[] = [];
    for (let round = 0; round < 3; round += 1) tokens.push((await enrolDemo()).deviceToken);

    expect(new Set(tokens).size).toBe(3);
    expect(await Promise.all(tokens.map(meWith))).toEqual([401, 401, 200]);
  });

  it('rebinds the same terminal and resumes its counters (ARCH §4.3)', async () => {
    await updateTerminal({ enrolmentCodeReusable: true });
    const first = await enrolDemo();
    await updateTerminal({ lastAppliedSeq: 41, receiptSeq: 123, returnSeq: 17 });

    const second = await enrolDemo();

    expect(second).toMatchObject({
      terminalId: first.terminalId,
      terminalCode: first.terminalCode,
      lastAppliedSeq: 41,
      receiptSeq: 123,
      returnSeq: 17,
    });
  });

  it('keeps an ordinary code single-use', async () => {
    await enrolDemo();

    expect((await enrol(CODE, demo)).status).toBe(401);
  });

  it('still refuses a deactivated terminal', async () => {
    await updateTerminal({ enrolmentCodeReusable: true, isActive: false });

    expect((await enrol(CODE, demo)).status).toBe(401);
  });
});

describe('device token guard', () => {
  const me = (authorization?: string) =>
    app.request('/v1/probe/me', { headers: authorization ? { authorization } : {} });

  it('identifies the terminal and its store', async () => {
    const token = await enrolledToken();

    const response = await app.request('/v1/probe/me', { token });

    expect(response).toMatchObject({ status: 200 });
    expect(response.body).toEqual({
      id: fixtures.terminal.id,
      code: 'T1',
      storeId: fixtures.store.id,
      storeCode: 'S01',
    });
  });

  it.each([
    ['no header', () => undefined],
    ['another scheme', (token: string) => `Basic ${token}`],
    ['a bare token', (token: string) => token],
    ['an empty token', () => 'Bearer '],
    ['an unknown token', () => `Bearer ${'A'.repeat(43)}`],
    ['the stored hash', (token: string) => `Bearer ${sha256(token)}`],
    ['trailing text', (token: string) => `Bearer ${token} extra`],
  ])('answers 401 for %s', async (_, header) => {
    const token = await enrolledToken();

    const response = await me(header(token));

    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('UNAUTHORIZED');
  });

  it.each([
    ['revoked', { deviceTokenHash: null }],
    ['deactivated', { isActive: false }],
  ])('answers 401 once the terminal is %s', async (_, change) => {
    const token = await enrolledToken();
    expect((await me(`Bearer ${token}`)).status).toBe(200);

    await updateTerminal(change);

    expect((await me(`Bearer ${token}`)).status).toBe(401);
  });
});
