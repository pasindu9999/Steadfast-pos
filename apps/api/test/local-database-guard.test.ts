/** The guard in front of every destructive or schema-changing local command (CLAUDE.md). */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const GUARD = fileURLToPath(new URL('../scripts/assert-local-database.mjs', import.meta.url));
const LOCAL = 'postgresql://pos:pos@127.0.0.1:5432/pos';
const REMOTE = 'postgresql://pos:s3cret@db.example.com:5432/pos';

/** An empty folder, so no real `.env` is read. */
let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'pos-guard-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

function guard(variables: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['DATABASE_URL'];
  delete env['DIRECT_URL'];
  return spawnSync(process.execPath, [GUARD], {
    cwd: folder,
    env: { ...env, ...variables },
    encoding: 'utf8',
  });
}

describe('assert-local-database', () => {
  it.each<[string, Record<string, string>]>([
    ['the local database', { DATABASE_URL: LOCAL }],
    ['local addresses for both', { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL }],
    ['an IPv6 loopback', { DATABASE_URL: 'postgresql://pos:pos@[::1]:5432/pos' }],
  ])('allows %s', (_, variables) => {
    expect(guard(variables).status).toBe(0);
  });

  it.each<[string, Record<string, string>]>([
    ['no database at all', {}],
    ['a remote DATABASE_URL', { DATABASE_URL: REMOTE }],
    // Prisma's commands connect with DIRECT_URL when it is set.
    ['a remote DIRECT_URL', { DATABASE_URL: LOCAL, DIRECT_URL: REMOTE }],
    ['only a remote DIRECT_URL', { DIRECT_URL: REMOTE }],
    ['a host override', { DATABASE_URL: `${LOCAL}?host=db.example.com` }],
    ['an unreadable URL', { DATABASE_URL: 'not a url' }],
  ])('refuses %s', (_, variables) => {
    const result = guard(variables);

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('s3cret');
  });

  it('reads DIRECT_URL from .env too', () => {
    writeFileSync(join(folder, '.env'), `DIRECT_URL=${REMOTE}\n`);

    expect(guard({ DATABASE_URL: LOCAL }).status).toBe(1);
  });
});
