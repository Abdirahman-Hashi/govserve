import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PasswordSchema } from '@govserve/shared';
import { AppModule } from '../app.module';
import { AuditService, SYSTEM_ACTOR } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { StaffService } from '../users/staff.service';

/**
 * Staff accounts the Playwright flows sign in with (address office, plus an admin). The accessibility
 * suite has its own, because specs run in parallel and two sign-ins to one account share a mailbox.
 */
export const E2E_STAFF = [
  { email: 'e2e-officer@govserve.test', fullName: 'E2E Officer', role: 'OFFICER' },
  { email: 'e2e-supervisor@govserve.test', fullName: 'E2E Supervisor', role: 'SUPERVISOR' },
  { email: 'e2e-admin@govserve.test', fullName: 'E2E Admin', role: 'ADMIN' },
  { email: 'e2e-a11y-officer@govserve.test', fullName: 'E2E A11y Officer', role: 'OFFICER' },
  {
    email: 'e2e-a11y-supervisor@govserve.test',
    fullName: 'E2E A11y Supervisor',
    role: 'SUPERVISOR',
  },
  { email: 'e2e-a11y-admin@govserve.test', fullName: 'E2E A11y Admin', role: 'ADMIN' },
] as const;

/**
 * Creates (or resets the password of) the e2e staff accounts. Never runs in production.
 * Usage: E2E_STAFF_PASSWORD=... pnpm --filter api e2e:staff (or, in a built image,
 * `node dist/cli/e2e-staff.js`, which `make e2e` runs inside the local stack's api container).
 */
async function main(): Promise<void> {
  const envFile = resolve(__dirname, '../../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  // Staging runs production builds, so the guard is the deployment, not NODE_ENV.
  if (process.env['DEPLOY_ENV'] === 'production') {
    process.stderr.write('Refusing to create e2e staff accounts in production.\n');
    process.exitCode = 1;
    return;
  }
  const password = PasswordSchema.safeParse(process.env['E2E_STAFF_PASSWORD']);
  if (!password.success) {
    process.stderr.write('Set E2E_STAFF_PASSWORD to a strong password (12+ characters).\n');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    for (const staff of E2E_STAFF) {
      const existing = await prisma.user.findUnique({ where: { email: staff.email } });
      if (!existing) {
        const { link } = await app.get(StaffService).invite(SYSTEM_ACTOR, {
          ...staff,
          departmentCode: staff.role === 'ADMIN' ? null : 'ADDRESS',
        });
        const token = new URL(link).searchParams.get('token')!;
        await app
          .get(AuthService)
          .acceptInvitation(
            { token, password: password.data },
            { ip: null, userAgent: 'e2e-staff', requestId: null },
          );
        process.stdout.write(`Created ${staff.email}\n`);
        continue;
      }
      const passwordHash = await app.get(PasswordService).hash(password.data);
      await prisma.$transaction(async (tx) => {
        // Every e2e run signs in from new browsers; clear the day's codes so the daily cap
        // (AUTH_POLICY.otpDailyCodes) applies to real accounts, not to repeated test runs.
        await tx.otpCode.deleteMany({ where: { email: staff.email } });
        await tx.user.update({
          where: { id: existing.id },
          data: { passwordHash, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null },
        });
        await app.get(AuditService).record(tx, {
          actor: SYSTEM_ACTOR,
          action: 'E2E_STAFF_PASSWORD_RESET',
          entityType: 'User',
          entityId: existing.id,
          departmentId: existing.departmentId,
        });
      });
      process.stdout.write(`Reset ${staff.email}\n`);
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) void main();
