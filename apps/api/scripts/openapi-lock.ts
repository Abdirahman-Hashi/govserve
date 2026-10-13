import 'reflect-metadata';
import { existsSync, writeFileSync } from 'node:fs';
import {
  buildContractDocument,
  changelogHas,
  LOCK_FILE,
  type OpenApiLock,
  readLock,
  specHash,
} from '../src/openapi-contract';

/**
 * Records the API contract after an intentional change. Refuses unless the version in
 * src/openapi-finalize.ts was bumped and docs/API_CHANGELOG.md has a note for it.
 */
async function main(): Promise<void> {
  const doc = await buildContractDocument();
  const next: OpenApiLock = { version: doc.info.version, sha256: specHash(doc) };
  const current = existsSync(LOCK_FILE) ? readLock() : null;
  if (current?.sha256 === next.sha256 && current.version === next.version) {
    process.stdout.write(`OpenAPI contract unchanged (${next.version}).\n`);
    return;
  }
  if (current && current.version === next.version) {
    process.stderr.write(
      `The API contract changed but its version is still ${next.version}. Bump API_VERSION in src/openapi-finalize.ts and add a note to docs/API_CHANGELOG.md.\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (!changelogHas(next.version)) {
    process.stderr.write(`Add a "## ${next.version}" note to docs/API_CHANGELOG.md first.\n`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(LOCK_FILE, `${JSON.stringify(next, null, 2)}\n`);
  process.stdout.write(
    `OpenAPI contract locked at ${next.version} (${next.sha256.slice(0, 12)}…).\n`,
  );
}

void main();
