import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { type Role } from '@govserve/shared';
import { AppModule } from '../src/app.module';
import { listRoutes } from './route-inventory';

const ROLES: Role[] = ['CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN'];

interface Row {
  method: string;
  path: string;
  access: Record<Role, string>;
  undecided: boolean;
}

/** Prints every route's @Public()/@Roles() decision as a markdown table. */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  const rows: Row[] = listRoutes(app).map((r) => ({
    method: r.method,
    path: r.path,
    access: Object.fromEntries(
      ROLES.map((x) => [x, r.isPublic ? 'public' : r.roles.includes(x) ? '✓' : '—']),
    ) as Record<Role, string>,
    undecided: !r.isPublic && r.roles.length === 0,
  }));
  await app.close();

  const lines = [
    `| Endpoint | ${ROLES.join(' | ')} |`,
    `| --- | ${ROLES.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (r) =>
        `| \`${r.method} ${r.path}\`${r.undecided ? ' ⚠ NO DECISION' : ''} | ${ROLES.map((x) => r.access[x]).join(' | ')} |`,
    ),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  const undecided = rows.filter((r) => r.undecided);
  if (undecided.length > 0) {
    process.stderr.write(
      `\n${undecided.length} endpoint(s) have no @Roles()/@Public() decision.\n`,
    );
    process.exitCode = 1;
  }
}

void main();
