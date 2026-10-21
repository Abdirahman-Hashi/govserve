import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PasswordSchema } from '@govserve/shared';
import { AppModule } from '../app.module';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

/** loadtest-001@govserve.test … the k6 scenarios sign in as these (docs/RUNBOOK.md §Load test). */
export const loadtestEmail = (n: number) => `loadtest-${String(n).padStart(3, '0')}@govserve.test`;

/**
 * Creates verified citizen accounts for the k6 load test, or resets their passwords. Never runs in
 * production. Usage: LOADTEST_PASSWORD=... node dist/cli/loadtest-citizens.js 270
 */
async function main(): Promise<void> {
  if (process.env['DEPLOY_ENV'] === 'production') {
    process.stderr.write('Refusing to create load-test accounts in production.\n');
    process.exitCode = 1;
    return;
  }
  const password = PasswordSchema.safeParse(process.env['LOADTEST_PASSWORD']);
  const count = Number.parseInt(process.argv[2] ?? '270', 10);
  if (!password.success || !Number.isInteger(count) || count < 1 || count > 999) {
    process.stderr.write(
      'Set LOADTEST_PASSWORD (12+ characters) and give a count from 1 to 999.\n',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const crypto = app.get(CryptoService);
    const passwordHash = await app.get(PasswordService).hash(password.data);
    let created = 0;
    for (let n = 1; n <= count; n += 1) {
      const email = loadtestEmail(n);
      const phone = `+252 61 ${String(1_000_000 + n).slice(1, 4)} ${String(1_000_000 + n).slice(4)}`;
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { email },
          update: { passwordHash, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null },
          create: {
            email,
            fullName: `Load Test ${n}`,
            passwordHash,
            role: 'CITIZEN',
            emailVerifiedAt: new Date(),
            phoneEnc: crypto.encrypt(phone),
            phoneBidx: crypto.blindIndex('phone', phone),
            citizenProfile: { create: {} },
          },
        });
        await app.get(AuditService).record(tx, {
          actor: SYSTEM_ACTOR,
          action: 'LOADTEST_CITIZEN_SET',
          entityType: 'User',
          entityId: user.id,
        });
      });
      created += 1;
    }
    process.stdout.write(`${created} load-test citizens ready.\n`);
  } finally {
    await app.close();
  }
}

if (require.main === module) void main();
