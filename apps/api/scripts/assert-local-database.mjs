import { existsSync } from 'node:fs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

if (existsSync('.env')) {
  process.loadEnvFile();
}

const databaseUrl = URL.parse(process.env.DATABASE_URL ?? '');
// A `host` query parameter overrides the URL's hostname in Postgres connection strings.
const isLocal =
  databaseUrl !== null &&
  LOCAL_HOSTS.has(databaseUrl.hostname) &&
  !databaseUrl.searchParams.has('host');

if (!isLocal) {
  console.error('Refusing to continue: DATABASE_URL must point to the local Docker database.');
  process.exit(1);
}
