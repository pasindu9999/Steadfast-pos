/**
 * Stops a command that changes or drops the schema unless every database it could reach is local.
 * `prisma.config.ts` connects with `DIRECT_URL` when it is set, so both variables are checked.
 */
import { existsSync } from 'node:fs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

if (existsSync('.env')) {
  process.loadEnvFile();
}

function isLocal(value) {
  const url = URL.parse(value);
  // A `host` query parameter overrides the URL's hostname in Postgres connection strings.
  return url !== null && LOCAL_HOSTS.has(url.hostname) && !url.searchParams.has('host');
}

const configured = ['DATABASE_URL', 'DIRECT_URL'].filter((name) => process.env[name]);
const elsewhere = configured.filter((name) => !isLocal(process.env[name]));

if (configured.length === 0 || elsewhere.length > 0) {
  // Names only: a connection string holds a password.
  const names = elsewhere.join(' and ') || 'DATABASE_URL';
  console.error(`Refusing to continue: ${names} must point to the local Docker database.`);
  process.exit(1);
}
