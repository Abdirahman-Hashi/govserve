import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read-only go-live checks on the live database (docs/LAUNCH_CHECKLIST.md). Exits 1 when any fails.
 * On the VM: docker exec govserve-stack-api-1 node dist/cli/launch-check.js
 *
 * Published service versions are immutable, so the seeded test-fee versions stay in the table once
 * official versions replace them. What must hold at launch is that no live version still charges a
 * test fee and that no application was ever assessed under one.
 */
async function main(): Promise<void> {
  const envFile = resolve(__dirname, '../../../../.env'); // local runs; containers get real env
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const failures: string[] = [];
  const notes: string[] = [];
  try {
    const prisma = app.get(PrismaService);
    const testFees = await prisma.serviceVersion.findMany({
      where: { feeIsTest: true },
      select: {
        versionNo: true,
        status: true,
        service: { select: { code: true } },
        _count: { select: { applications: true } },
      },
      orderBy: [{ serviceId: 'asc' }, { versionNo: 'asc' }],
    });
    for (const v of testFees) {
      const label = `${v.service.code} v${v.versionNo} (${v.status})`;
      if (v.status !== 'RETIRED')
        failures.push(
          `${label} still has test fees (feeIsTest = true); publish official fees (O-1)`,
        );
      else if (v._count.applications > 0)
        failures.push(
          `${label} has test fees and ${v._count.applications} application(s) assessed under it`,
        );
      else notes.push(`${label}: retired test-fee version, never used`);
    }
    const fixtures = await prisma.user.count({
      where: {
        status: { not: 'DEACTIVATED' },
        OR: [
          { email: { startsWith: 'e2e-' } },
          { email: { startsWith: 'loadtest-' } },
          { email: { endsWith: '@govserve.test' } },
        ],
      },
    });
    if (fixtures > 0)
      failures.push(
        `${fixtures} active test account(s) (e2e-*, loadtest-*, @govserve.test); deactivate them`,
      );
  } finally {
    await app.close();
  }
  for (const n of notes) process.stdout.write(`note  ${n}\n`);
  for (const f of failures) process.stdout.write(`FAIL  ${f}\n`);
  process.stdout.write(
    failures.length === 0 ? 'Launch checks passed.\n' : `${failures.length} check(s) failed.\n`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

if (require.main === module) void main();
