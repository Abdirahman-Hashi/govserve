import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { matrixMarkdown } from '../test/int/authz-matrix';

/** Regenerates docs/AUTHZ_MATRIX.md from test/int/authz-matrix.ts. */
writeFileSync(join(__dirname, '../../../docs/AUTHZ_MATRIX.md'), matrixMarkdown());
