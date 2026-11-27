import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

import { runPrisma } from './helpers/prisma-cli.js';

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const databaseUrl = container.getConnectionUri();

  const migration = runPrisma(['migrate', 'deploy'], databaseUrl);
  if (migration.status !== 0) {
    await container.stop();
    throw new Error(`prisma migrate deploy failed:\n${migration.stdout}\n${migration.stderr}`);
  }

  project.provide('databaseUrl', databaseUrl);
  return async () => {
    await container.stop();
  };
}
