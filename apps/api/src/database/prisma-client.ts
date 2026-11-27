import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

export function prismaOptions(databaseUrl: string) {
  return { adapter: new PrismaPg({ connectionString: databaseUrl }) };
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient(prismaOptions(databaseUrl));
}
