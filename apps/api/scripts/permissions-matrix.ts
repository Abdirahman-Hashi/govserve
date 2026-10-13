import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NestFactory, ModulesContainer } from '@nestjs/core';
import { type Role } from '@govserve/shared';
import { AppModule } from '../src/app.module';
import { API_PREFIX } from '../src/app.setup';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';

const ROLES: Role[] = ['CITIZEN', 'OFFICER', 'SUPERVISOR', 'ADMIN'];
const UNPREFIXED = new Set(['/health', '/ready']);

interface Row {
  method: string;
  path: string;
  access: Record<Role, string>;
  undecided: boolean;
}

/** Reads every route's @Public()/@Roles() decision straight from the compiled controllers. */
async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  const rows: Row[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (!controller) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
      const classRoles = Reflect.getMetadata(ROLES_KEY, controller) as Role[] | undefined;
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (verb === undefined) continue;
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
        const raw = `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
        const path = UNPREFIXED.has(raw) ? raw : `/${API_PREFIX}${raw}`;
        const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true || classPublic;
        const roles =
          (Reflect.getMetadata(ROLES_KEY, handler) as Role[] | undefined) ?? classRoles ?? [];
        const access = Object.fromEntries(
          ROLES.map((r) => [r, isPublic ? 'public' : roles.includes(r) ? '✓' : '—']),
        ) as Record<Role, string>;
        rows.push({
          method: RequestMethod[verb],
          path,
          access,
          undecided: !isPublic && roles.length === 0,
        });
      }
    }
  }
  await app.close();

  rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
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
