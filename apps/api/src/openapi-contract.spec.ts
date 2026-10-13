import { type OpenAPIObject } from '@nestjs/swagger';
import { buildContractDocument, changelogHas, readLock, specHash } from './openapi-contract';

type Op = {
  summary?: string;
  description?: string;
  security?: unknown[];
  responses?: Record<string, { content?: Record<string, { schema?: unknown; example?: unknown }> }>;
  requestBody?: { content?: Record<string, { example?: unknown }> };
  parameters?: { name: string; example?: unknown }[];
};

/** Operational probes for load balancers, deliberately outside /api/v1 (Phase 01). */
const PROBES = new Set(['/health', '/ready']);

describe('OpenAPI contract', () => {
  let doc: OpenAPIObject;
  let ops: [string, Op][];

  beforeAll(async () => {
    doc = await buildContractDocument();
    ops = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.entries(item as Record<string, Op>).map(
        ([m, op]) => [`${m.toUpperCase()} ${path}`, op] as [string, Op],
      ),
    );
  }, 60_000);

  it('should version every API path under /api/v1', () => {
    expect(
      Object.keys(doc.paths).filter((p) => !p.startsWith('/api/v1/') && !PROBES.has(p)),
    ).toEqual([]);
  });

  it('should give every operation a summary and an explicit auth decision', () => {
    const bad = ops.filter(([, op]) => {
      const text = op.description ?? '';
      const isPublic = Array.isArray(op.security) && op.security.length === 0;
      return (
        !op.summary ||
        !Array.isArray(op.security) ||
        !(text.includes('Roles:') || (isPublic && text.includes('Public')))
      );
    });
    expect(bad.map(([name]) => name)).toEqual([]);
  });

  it('should document a success response with a schema and an example', () => {
    const bad = ops.filter(([, op]) => {
      const ok = Object.entries(op.responses ?? {}).filter(([s]) => s.startsWith('2'));
      if (ok.length === 0) return true;
      return ok.some(([, r]) => {
        const json = r.content?.['application/json'];
        return json !== undefined && (json.schema === undefined || json.example === undefined);
      });
    });
    expect(bad.map(([name]) => name)).toEqual([]);
  });

  it('should give every JSON request body and parameter an example', () => {
    const bad = ops.filter(
      ([, op]) =>
        (op.requestBody?.content?.['application/json'] &&
          op.requestBody.content['application/json'].example === undefined) ||
        (op.parameters ?? []).some((p) => p.example === undefined),
    );
    expect(bad.map(([name]) => name)).toEqual([]);
  });

  it('should document error codes with the shared error envelope', () => {
    const bad = ops.filter(([, op]) => {
      const errors = Object.entries(op.responses ?? {}).filter(([s]) => Number(s) >= 400);
      return (
        errors.length === 0 ||
        errors.some(
          ([, r]) =>
            JSON.stringify(r.content?.['application/json']?.schema) !==
            '{"$ref":"#/components/schemas/ErrorEnvelope"}',
        )
      );
    });
    expect(bad.map(([name]) => name)).toEqual([]);
  });

  it('should match the locked contract (run `pnpm --filter api openapi:lock` after an intentional change)', () => {
    const lock = readLock();
    expect({ version: doc.info.version, sha256: specHash(doc) }).toEqual(lock);
    expect(changelogHas(lock.version)).toBe(true);
  });
});
