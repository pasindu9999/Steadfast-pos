import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env files on its own.
if (existsSync('.env')) {
  process.loadEnvFile();
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Optional so that `prisma generate` works in CI and builds without a database.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
