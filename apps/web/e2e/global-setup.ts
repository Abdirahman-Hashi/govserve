import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Creates or resets the e2e staff accounts (address office) before the run. The officer flow is
 * skipped when E2E_STAFF_PASSWORD is not set, so a plain `pnpm test:e2e` still works.
 */
export default function globalSetup(): void {
  if (!process.env['E2E_STAFF_PASSWORD'] || process.env['E2E_BASE_URL']) return;
  execFileSync('pnpm', ['--filter', 'api', 'e2e:staff'], {
    cwd: resolve(import.meta.dirname, '../../..'),
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });
}
