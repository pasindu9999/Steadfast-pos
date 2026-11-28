import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env files on its own.
if (existsSync('.env')) {
  process.loadEnvFile();
}

// Only Prisma's commands read this; the app connects with `DATABASE_URL`. Migrations can't run
// through a transaction pooler such as Neon's, so `DIRECT_URL` wins when it is set (ARCH §8.1).
const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Optional so that `prisma generate` works in CI and builds without a database.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
