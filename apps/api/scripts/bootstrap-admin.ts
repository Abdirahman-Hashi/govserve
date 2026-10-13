import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { InviteStaffRequestSchema } from '@govserve/shared';
import { AppModule } from '../src/app.module';
import { SYSTEM_ACTOR } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StaffService } from '../src/users/staff.service';

/**
 * Creates the first admin invitation (FR-007: staff are only ever created by invitation).
 * Usage: pnpm --filter api admin:bootstrap --email admin@bra.gov.so --name "Full Name"
 * Refuses to run once any admin exists; later admins are invited from the admin UI.
 */
async function main(): Promise<void> {
  // Local runs read the repo-root .env; deployed environments provide real variables.
  const envFile = resolve(__dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  const body = InviteStaffRequestSchema.parse({
    email: values.email,
    fullName: values.name,
    role: 'ADMIN',
  });

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const admins = await app.get(PrismaService).user.count({ where: { role: 'ADMIN' } });
    if (admins > 0) {
      process.stderr.write('An admin already exists. Invite further admins from the admin UI.\n');
      process.exitCode = 1;
      return;
    }
    const { link, invitation } = await app.get(StaffService).invite(SYSTEM_ACTOR, body);
    process.stdout.write(
      `Admin invitation created for ${invitation.email} (expires ${invitation.expiresAt}).\n` +
        `It was also emailed. Open this one-time link to set the password:\n${link}\n`,
    );
  } finally {
    await app.close();
  }
}

void main();
