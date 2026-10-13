import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedReferenceData } from '../src/catalogue/seed';
import { PrismaClient } from '../src/generated/prisma/client';

/** `pnpm --filter api db:seed` — idempotent reference data (departments are seeded by migration). */
async function main(): Promise<void> {
  const envFile = resolve(__dirname, '../../../.env');
  if (!process.env['DATABASE_URL'] && existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const result = await seedReferenceData(prisma);
    process.stdout.write(
      `Seed complete: services created [${result.servicesCreated.join(', ') || 'none'}], ` +
        `${result.settingsCreated} settings, ${result.reasonCodesCreated} reason codes added.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
