import { existsSync } from 'node:fs';
import { z } from 'zod';

import { createPrismaClient } from '../src/database/prisma-client.js';
import { seedDatabase } from './seed/seed.js';

// A database already named in the environment, as `db:seed:prod` does, means `.env` is not read at
// all, so no local setting reaches another database.
if (!process.env['DATABASE_URL'] && !process.env['DIRECT_URL'] && existsSync('.env')) {
  process.loadEnvFile();
}

const databaseUrl = z.url({ protocol: /^postgres(ql)?$/ }).optional();
const enrolmentCode = z.string().min(8).max(64);
const env = z
  .object({
    DATABASE_URL: databaseUrl,
    /** A direct connection, preferred where `DATABASE_URL` goes through a pooler. */
    DIRECT_URL: databaseUrl,
    SEED_ENROL_CODE_T1: enrolmentCode.default('DEMO-S01-T1'),
    SEED_ENROL_CODE_T2: enrolmentCode.default('DEMO-S01-T2'),
  })
  .parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')));

const target = env.DIRECT_URL ?? env.DATABASE_URL;
if (!target) throw new Error('Set DATABASE_URL or DIRECT_URL to the database to seed.');

// The host and database name only: the URL holds a password.
const { hostname, pathname } = new URL(target);
console.log(`Seeding database "${pathname.slice(1)}" on ${hostname}`);

const prisma = createPrismaClient(target);
try {
  const { products, variants } = await seedDatabase(prisma, {
    large: process.argv.includes('--large'),
    enrolmentCodes: { T1: env.SEED_ENROL_CODE_T1, T2: env.SEED_ENROL_CODE_T2 },
  });
  console.log(`Seed complete: ${products} products, ${variants} variants.`);
} finally {
  await prisma.$disconnect();
}
