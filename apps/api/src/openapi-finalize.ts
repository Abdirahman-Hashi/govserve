import { type OpenAPIObject } from '@nestjs/swagger';

/** Semantic version of the API contract; URIs stay /api/v1. Bump with a note in docs/API_CHANGELOG.md. */
export const API_VERSION = '1.10.0';

type Json = Record<string, unknown>;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const ERROR_ENVELOPE: Json = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string', example: 'VALIDATION_FAILED' },
        message: { type: 'string', example: 'Please check the highlighted fields.' },
        details: {
          nullable: true,
          example: [{ path: 'amountCents', message: 'Whole cents only' }],
        },
        requestId: { type: 'string', example: '01a1371d-5219-7600-a412-92f9509b15ce' },
      },
    },
  },
};

const STANDARD: Record<string, string> = {
  '401': 'UNAUTHENTICATED (missing, expired or revoked token)',
  '422': 'VALIDATION_FAILED (details list each field)',
  '429': 'RATE_LIMITED (too many requests; retry later)',
  '500': 'INTERNAL (logged with the requestId)',
};

/** Example values by property name, for fields whose format alone says too little. */
const BY_NAME: Record<string, unknown> = {
  referenceNo: 'GS-2026-000042',
  receiptNo: 'R-2026-000001',
  certificateNo: 'ADR-2026-000001',
  serviceCode: 'PROOF_OF_ADDRESS',
  service: 'PROOF_OF_ADDRESS',
  email: 'amina@example.com',
  fullName: 'Amina Hassan',
  applicantName: 'Amina Hassan',
  holderName: 'Amina Hassan',
  holderNameMasked: 'Amina H***',
  phone: '+252 61 234 5678',
  password: 'mango river lantern 42',
  code: '123456',
  note: 'Explained to the citizen at the counter.',
  reason: 'DUPLICATE_PAYMENT',
  channel: 'MOBILE_MONEY',
  provider: 'EVC_PLUS',
  reference: 'TX8839201',
  location: 'Banadir HQ, room 4',
  chainSeq: '1241',
  entityType: 'Application',
  entityId: '0199e0a8-7c1b-7d2e-9f00-000000000042',
  action: 'APPLICATION_SUBMITTED',
  q: '000042',
  name: 'Hodan Ali',
  nationalId: 'SO1234567',
};

function resolveRef(ref: string, doc: OpenAPIObject): Json | undefined {
  const name = ref.replace('#/components/schemas/', '');
  return doc.components?.schemas?.[name] as Json | undefined;
}

/** A plausible example for a JSON schema (OpenAPI 3.0 subset). Deterministic, so the spec hash is stable. */
export function exampleFor(
  schema: Json | undefined,
  doc: OpenAPIObject,
  name?: string,
  depth = 0,
): unknown {
  if (!schema || depth > 8) return null;
  if ('example' in schema) return schema['example'];
  if (Array.isArray(schema['examples']) && schema['examples'].length > 0)
    return (schema['examples'] as unknown[])[0];
  if (typeof schema['$ref'] === 'string')
    return exampleFor(resolveRef(schema['$ref'], doc), doc, name, depth + 1);
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const list = schema[key] as Json[] | undefined;
    if (list?.length) {
      if (key === 'allOf') {
        return Object.assign({}, ...list.map((s) => exampleFor(s, doc, name, depth + 1) as object));
      }
      const first = list.find((s) => s['type'] !== 'null') ?? list[0];
      return exampleFor(first, doc, name, depth + 1);
    }
  }
  if ('const' in schema) return schema['const'];
  if (Array.isArray(schema['enum'])) return (schema['enum'] as unknown[])[0];
  if (name && name in BY_NAME) return BY_NAME[name];
  const type = Array.isArray(schema['type'])
    ? (schema['type'] as string[]).find((t) => t !== 'null')
    : schema['type'];
  switch (type) {
    case 'object': {
      const props = (schema['properties'] ?? {}) as Record<string, Json>;
      return Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, exampleFor(v, doc, k, depth + 1)]),
      );
    }
    case 'array':
      return [exampleFor(schema['items'] as Json, doc, name, depth + 1)];
    case 'integer':
    case 'number':
      return typeof schema['minimum'] === 'number' ? Math.max(schema['minimum'], 1) : 1;
    case 'boolean':
      return true;
    case 'string': {
      const format = schema['format'];
      if (format === 'uuid') return '0199e0a8-7c1b-7d2e-9f00-000000000042';
      if (format === 'date-time') return '2026-10-14T08:00:00.000Z';
      if (format === 'date') return '2026-10-14';
      if (format === 'email') return 'amina@example.com';
      if (format === 'uri') return 'https://govserve.example.so/verify/r/R-2026-000001';
      const pattern = typeof schema['pattern'] === 'string' ? schema['pattern'] : '';
      if (name === 'cursor')
        return /^\^\\d/.test(pattern) ? '1241' : 'MjAyNi0xMC0xNFQwODowMDowMC4wMDBafDAxOTk';
      if (/Cents$/.test(name ?? '') || pattern.includes('\\d+$') || pattern === '^-?\\d+$')
        return '1500';
      return name ? `${name}` : 'string';
    }
    default:
      return null;
  }
}

/**
 * Finishes the generated document (FR: Phase 10 API docs): one error envelope schema on every
 * error response, the standard 401/422/429/500 responses, explicit `security` (empty for public
 * operations) and an example for every JSON request and response that has none.
 */
export function finalizeOpenApi(doc: OpenAPIObject): OpenAPIObject {
  doc.info.version = API_VERSION;
  doc.components ??= {};
  doc.components.schemas = { ...(doc.components.schemas ?? {}), ErrorEnvelope: ERROR_ENVELOPE };
  for (const path of Object.values(doc.paths)) {
    for (const method of METHODS) {
      const op = (path as Record<string, Json | undefined>)[method];
      if (!op) continue;
      const security = op['security'] as unknown[] | undefined;
      const isPublic = !security || security.length === 0;
      op['security'] = isPublic ? [] : security;
      const responses = (op['responses'] ??= {}) as Record<string, Json>;
      const hasInput =
        Boolean(op['requestBody']) ||
        ((op['parameters'] as unknown[] | undefined)?.length ?? 0) > 0;
      for (const [status, description] of Object.entries(STANDARD)) {
        if (status === '401' && isPublic) continue;
        if (status === '422' && !hasInput) continue;
        responses[status] ??= { description };
      }
      for (const [status, res] of Object.entries(responses)) {
        const description = typeof res['description'] === 'string' ? res['description'] : '';
        const content = res['content'] as Record<string, Json> | undefined;
        if (Number(status) >= 400) {
          const code = /^[A-Z][A-Z_]+/.exec(description)?.[0] ?? 'ERROR';
          res['content'] = {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              example: {
                error: {
                  code,
                  message: description || code,
                  details: null,
                  requestId: 'req-0001',
                },
              },
            },
          };
          continue;
        }
        const json = content?.['application/json'];
        if (json && !('example' in json) && !('examples' in json)) {
          json['example'] = exampleFor(json['schema'] as Json, doc);
        }
      }
      const body = (op['requestBody'] as Json | undefined)?.['content'] as
        Record<string, Json> | undefined;
      const jsonBody = body?.['application/json'];
      if (jsonBody && !('example' in jsonBody)) {
        const schema = jsonBody['schema'] as Json | undefined;
        jsonBody['example'] =
          schema && 'example' in schema ? schema['example'] : exampleFor(schema, doc);
      }
      for (const p of (op['parameters'] as Json[] | undefined) ?? []) {
        if (!('example' in p))
          p['example'] = exampleFor(p['schema'] as Json, doc, String(p['name']));
      }
    }
  }
  return doc;
}
