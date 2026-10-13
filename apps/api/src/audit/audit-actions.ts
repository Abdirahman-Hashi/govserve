import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Strings that look like audit actions but are error codes or event names, not audit rows. */
const NOT_AUDIT = new Set(['DOCUMENT_PURGED']);

const PATTERNS = [
  /\baction:\s*'([A-Z][A-Z0-9_]+)'/g,
  /\baudit:\s*'([A-Z][A-Z0-9_]+)'/g,
  /\.record\(\s*tx,[^;]*?'([A-Z][A-Z0-9]*_[A-Z0-9_]+)'/gs,
  /'(APPLICATION_[A-Z_]+|CERTIFICATE_[A-Z_]+|DOCUMENT_[A-Z_]+|SIGNING_KEY_[A-Z_]+)'/g,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : files(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Every audit action the API source can write (FR-130 coverage). */
export function auditActionsInCode(srcDir = resolve(__dirname, '..')): Set<string> {
  const found = new Set<string>();
  for (const file of files(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const p of PATTERNS) for (const m of text.matchAll(p)) found.add(m[1]!);
  }
  for (const x of NOT_AUDIT) found.delete(x);
  return found;
}

/** The actions listed in docs/AUDIT_COVERAGE.md. */
export function auditActionsInDoc(
  doc = resolve(__dirname, '../../../../docs/AUDIT_COVERAGE.md'),
): Set<string> {
  return new Set(
    [...readFileSync(doc, 'utf8').matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm)].map((m) => m[1]!),
  );
}
