import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const apiRoot = fileURLToPath(new URL('../..', import.meta.url));

export function runPrisma(args: string[], databaseUrl: string) {
  return spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: apiRoot,
    // Both, so a developer's `.env` can't send a test migration anywhere else.
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    encoding: 'utf8',
  });
}
