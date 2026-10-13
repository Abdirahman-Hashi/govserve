import { existsSync, readFileSync, rmSync } from 'node:fs';
import { auditActionsInDoc } from '../../src/audit/audit-actions';

interface GlobalConfig {
  testPathPatterns?: { patterns?: string[] } | string[];
  testNamePattern?: string;
}

/**
 * FR-130 coverage: on a full integration run, every action in docs/AUDIT_COVERAGE.md must have
 * been written at least once (by AuditService, inside the caller's transaction). Partial runs
 * (a file or test name filter) skip the check.
 */
export default function globalTeardown(config: GlobalConfig): void {
  const file = process.env['AUDIT_OBSERVED_FILE'];
  if (!file || !existsSync(file)) return;
  const observed = new Set(readFileSync(file, 'utf8').split('\n').filter(Boolean));
  rmSync(file, { force: true });
  const patterns = Array.isArray(config.testPathPatterns)
    ? config.testPathPatterns
    : (config.testPathPatterns?.patterns ?? []);
  if (patterns.length > 0 || config.testNamePattern) return;
  const missing = [...auditActionsInDoc()].filter((a) => !observed.has(a)).sort();
  if (missing.length > 0) {
    throw new Error(
      `Audit coverage: these listed actions were never written during the integration run:\n  ${missing.join('\n  ')}`,
    );
  }
  process.stdout.write(
    `\nAudit coverage: all ${auditActionsInDoc().size} listed actions were written during the run.\n`,
  );
}
