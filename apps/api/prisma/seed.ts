import { existsSync } from 'node:fs';
import { z } from 'zod';

import { createPrismaClient } from '../src/database/prisma-client.js';
import { seedDatabase } from './seed/seed.js';

if (existsSync('.env')) {
  process.loadEnvFile();
}

const enrolmentCode = z.string().min(8).max(64);
const env = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    SEED_ENROL_CODE_T1: enrolmentCode.default('DEMO-S01-T1'),
    SEED_ENROL_CODE_T2: enrolmentCode.default('DEMO-S01-T2'),
  })
  .parse(process.env);

const prisma = createPrismaClient(env.DATABASE_URL);
try {
  const { products, variants } = await seedDatabase(prisma, {
    large: process.argv.includes('--large'),
    enrolmentCodes: { T1: env.SEED_ENROL_CODE_T1, T2: env.SEED_ENROL_CODE_T2 },
  });
  console.log(`Seed complete: ${products} products, ${variants} variants.`);
} finally {
  await prisma.$disconnect();
}
