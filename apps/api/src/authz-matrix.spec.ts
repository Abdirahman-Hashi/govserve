import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { listRoutes, type RouteInfo } from '../scripts/route-inventory';
import { MATRIX, matrixMarkdown } from '../test/int/authz-matrix';
import { AppModule } from './app.module';

const DOC = join(__dirname, '../../../docs/AUTHZ_MATRIX.md');

describe('authorization matrix (SPEC §2.1)', () => {
  let routes: RouteInfo[];

  beforeAll(async () => {
    const app = await NestFactory.create(AppModule, { preview: true, logger: false });
    routes = listRoutes(app);
    await app.close();
  }, 60_000);

  it('should list every endpoint exactly once when the controllers change', () => {
    const live = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(Object.keys(MATRIX).sort()).toEqual(live);
  });

  it('should match the role decorators when the matrix is compared with the code', () => {
    const drift = routes.flatMap((r) => {
      const rule = MATRIX[`${r.method} ${r.path}`];
      if (!rule) return [];
      const expectedPublic = rule.allow === 'public' || rule.allow === 'token';
      const same =
        r.isPublic === expectedPublic &&
        (expectedPublic ||
          [...r.roles].sort().join() === [...(rule.allow as string[])].sort().join());
      return same
        ? []
        : [`${r.method} ${r.path}: code ${r.isPublic ? 'public' : r.roles.join('/')}`];
    });
    expect(drift).toEqual([]);
  });

  it('should keep docs/AUTHZ_MATRIX.md generated when the matrix changes (pnpm --filter api authz:matrix)', () => {
    expect(readFileSync(DOC, 'utf8')).toBe(matrixMarkdown());
  });
});
