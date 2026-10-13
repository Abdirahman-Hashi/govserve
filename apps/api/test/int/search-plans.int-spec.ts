import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CryptoService } from '../../src/crypto/crypto.service';
import { Prisma } from '../../src/generated/prisma/client';
import { SearchService } from '../../src/search/search.service';
import { type AuthUser } from '../../src/auth/auth.types';
import { type Harness, startHarness } from './harness';

const ROWS = 100_000;
const USERS = 20_000;
const OUT = resolve(__dirname, '../../../../docs/perf/search-plans.md');

/**
 * EXPLAIN ANALYZE of every search shape on 100,000 seeded applications and payments (Phase 08
 * acceptance). The SQL is captured from SearchService itself, so the plans match production
 * queries. Big tables must never be scanned sequentially; selective lookups must use their index.
 */
describe('Search query plans on 100k rows (integration)', () => {
  let h: Harness;
  let search: SearchService;
  let staff: AuthUser;
  let citizen: AuthUser;
  let nationalId: string;
  const report: string[] = [];

  beforeAll(async () => {
    h = await startHarness();
    search = h.app.get(SearchService);
    const crypto = h.app.get(CryptoService);
    const services = await h.prisma.service.findMany({
      include: { versions: { where: { status: 'PUBLISHED' } } },
      orderBy: { code: 'asc' },
    });
    const keyId = (await h.prisma.signingKey.findFirstOrThrow()).id;
    // A plain table: a TEMP table would live on one pooled connection only.
    await h.prisma.$executeRawUnsafe(`CREATE TABLE seed_svc (i int, sid uuid, vid uuid, did uuid)`);
    for (const [i, s] of services.entries()) {
      await h.prisma
        .$executeRaw`INSERT INTO seed_svc VALUES (${i}, ${s.id}::uuid, ${s.versions[0]!.id}::uuid, ${s.departmentId}::uuid)`;
    }
    const n = services.length;
    await h.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`
          INSERT INTO "user" ("id", "email", "fullName", "phoneBidx", "role", "status", "updatedAt")
          SELECT gen_random_uuid(), 'seed' || g || '@example.com',
                 (ARRAY['Amina','Hodan','Cabdi','Faadumo','Maxamed','Xaliimo','Ayaan','Bashiir'])[1 + g % 8] || ' ' ||
                 (ARRAY['Hassan','Ali','Warsame','Faarax','Yusuf','Nuur','Cumar','Jaamac'])[1 + (g / 8) % 8] || ' ' ||
                 (ARRAY['Abdi','Osman','Aden','Mohamed','Ibrahim','Ahmed'])[1 + (g / 64) % 6],
                 md5('phone' || g), 'CITIZEN', 'ACTIVE', now()
          FROM generate_series(1, ${USERS}) g`);
        await tx.$executeRawUnsafe(`
          CREATE TEMP TABLE seed_user ON COMMIT DROP AS
          SELECT "id", row_number() OVER (ORDER BY "email") AS rn FROM "user" WHERE "email" LIKE 'seed%'`);
        await tx.$executeRawUnsafe(`
          INSERT INTO "application" ("id", "referenceNo", "applicantId", "serviceId", "serviceVersionId",
                                     "departmentId", "status", "submittedAt", "createdAt", "updatedAt")
          SELECT gen_random_uuid(), 'GS-2024-' || lpad(g::text, 7, '0'), u."id", s.sid, s.vid, s.did,
                 (ARRAY['QUEUED','IN_REVIEW','ISSUED','REJECTED'])[1 + g % 4]::"ApplicationStatus",
                 t.ts, t.ts, t.ts
          FROM generate_series(1, ${ROWS}) g
          JOIN seed_user u ON u.rn = 1 + g % ${USERS}
          JOIN seed_svc s ON s.i = g % ${n}
          CROSS JOIN LATERAL (SELECT now() - make_interval(mins => g) AS ts) t`);
        await tx.$executeRawUnsafe(`
          INSERT INTO "application_data" ("applicationId", "data", "subjectFullName", "subjectNationalIdBidx", "updatedAt")
          SELECT a."id", '{}'::jsonb, u."fullName", md5('nid' || a."referenceNo"), now()
          FROM "application" a JOIN "user" u ON u."id" = a."applicantId"
          WHERE a."referenceNo" LIKE 'GS-2024-%'`);
        await tx.$executeRawUnsafe(`
          INSERT INTO "payment" ("id", "applicationId", "channel", "provider", "reference", "referenceNorm",
                                 "amountCents", "paidAt", "status", "createdAt", "updatedAt")
          SELECT gen_random_uuid(), a."id",
                 (ARRAY['MOBILE_MONEY','BANK','CASH','CARD'])[1 + (row_number() OVER ()) % 4]::"PaymentChannel",
                 'EVC_PLUS', 'SEEDTX' || a."referenceNo", 'SEEDTX' || a."referenceNo",
                 (500 + (row_number() OVER ()) % 20000)::bigint, a."createdAt", 'CONFIRMED', a."createdAt", a."createdAt"
          FROM "application" a WHERE a."referenceNo" LIKE 'GS-2024-%'`);
        await tx.$executeRawUnsafe(`
          INSERT INTO "receipt" ("id", "receiptNo", "paymentId", "applicationId", "amountCents", "issuedAt", "payloadJson", "signature", "keyId")
          SELECT gen_random_uuid(), 'R-2024-' || lpad((row_number() OVER ())::text, 7, '0'), p."id", p."applicationId",
                 p."amountCents", p."createdAt", '{}'::jsonb, '\\x00'::bytea, '${keyId}'
          FROM "payment" p WHERE p."reference" LIKE 'SEEDTX%'`);
      },
      { timeout: 300_000 },
    );
    await h.prisma.$executeRawUnsafe(`DROP TABLE seed_svc`);
    await h.prisma.$executeRawUnsafe(
      `ANALYZE "user", "application", "application_data", "payment", "receipt", "citizen_profile"`,
    );

    // A real blind index for one seeded subject, and the people searching.
    nationalId = 'SO0042423';
    const target = await h.prisma.application.findUniqueOrThrow({
      where: { referenceNo: 'GS-2024-0042423' },
    });
    await h.prisma.applicationData.update({
      where: { applicationId: target.id },
      data: { subjectNationalIdBidx: crypto.blindIndex('nationalId', nationalId) },
    });
    // The target sits in the searching department (row 42423 → service 0), so lookups really match.
    const dept = target.departmentId;
    staff = {
      id: '0199e0a8-7c1b-7d2e-9f00-000000000001',
      role: 'SUPERVISOR',
      departmentId: dept,
      departmentCode: null,
      sid: 'plans',
    };
    citizen = {
      id: target.applicantId,
      role: 'CITIZEN',
      departmentId: null,
      departmentCode: null,
      sid: 'plans',
    };
  }, 600_000);

  afterAll(async () => {
    if (report.length > 0) {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(
        OUT,
        `# Search query plans (Phase 08)\n\nGenerated by \`test/int/search-plans.int-spec.ts\` on PostgreSQL 16 (Testcontainers) with ` +
          `${ROWS.toLocaleString('en')} applications, ${ROWS.toLocaleString('en')} payments and receipts and ` +
          `${USERS.toLocaleString('en')} users. Each query is captured from \`SearchService\` and run with ` +
          '`EXPLAIN (ANALYZE, BUFFERS)`. Timings vary by machine; the index choices are what the test asserts.\n\n' +
          report.join('\n'),
      );
    }
    await h?.close();
  });

  /** Runs the service call with $queryRaw captured, then EXPLAINs exactly that SQL. */
  async function plan(title: string, call: () => Promise<unknown>): Promise<string> {
    let captured: Prisma.Sql | undefined;
    const original = h.prisma.$queryRaw.bind(h.prisma);
    const spy = jest.spyOn(h.prisma, '$queryRaw').mockImplementation(((
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      captured ??= Prisma.sql(strings, ...values);
      return original(strings, ...values);
    }) as never);
    try {
      await call();
    } finally {
      spy.mockRestore();
    }
    const rows = await h.prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
      `EXPLAIN (ANALYZE, BUFFERS) ${captured!.text}`,
      ...captured!.values,
    );
    const text = rows.map((r) => r['QUERY PLAN']).join('\n');
    report.push(`## ${title}\n\n\`\`\`text\n${text}\n\`\`\`\n`);
    expect(text).not.toMatch(/Seq Scan on (application|payment|application_data|receipt) /);
    expect(text).not.toMatch(/Seq Scan on "?user"? /);
    return text;
  }

  it('department list, first page and next page (keyset)', async () => {
    const first = await plan('Staff: department list, first page', () =>
      search.staffApplications(staff, {}),
    );
    expect(first).toContain('application_departmentId_createdAt_id_idx');
    const page1 = await search.staffApplications(staff, {});
    const next = await plan('Staff: department list, page 2 (keyset cursor)', () =>
      search.staffApplications(staff, { cursor: page1.nextCursor! }),
    );
    expect(next).toContain('application_departmentId_createdAt_id_idx');
  });

  it('partial reference number (trigram)', async () => {
    expect(
      await plan('Staff: partial reference number', () =>
        search.staffApplications(staff, { referenceNo: '0042423' }),
      ),
    ).toContain('application_referenceNo_trgm_idx');
  });

  it('receipt and certificate number (exact)', async () => {
    expect(
      await plan('Staff: receipt number', () =>
        search.staffApplications(staff, { receiptNo: 'R-2024-0001234' }),
      ),
    ).toContain('receipt_receiptNo_key');
  });

  it('applicant or subject name (full-text)', async () => {
    const text = await plan('Staff: name (prefix words, any order)', () =>
      search.staffApplications(staff, { name: 'faarax hod' }),
    );
    expect(text).toMatch(/user_fullName_fts_idx|application_data_subjectFullName_fts_idx/);
  });

  it('national ID and phone (blind indexes)', async () => {
    const nid = await plan('Staff: national ID (blind index)', () =>
      search.staffApplications(staff, { nationalId }),
    );
    expect(nid).toContain('application_data_subjectNationalIdBidx_idx');
    // The match drives the lookup; the department index is not walked and filtered.
    expect(nid).not.toMatch(/Rows Removed by Filter: \d{4,}/);
    expect((await search.staffApplications(staff, { nationalId })).items).toHaveLength(1);
    expect(
      await plan('Staff: phone (blind index)', () =>
        search.staffApplications(staff, { phone: '+252 61 000 0000' }),
      ),
    ).toContain('user_phoneBidx_idx');
  });

  it('payments by department, amount range and channel', async () => {
    await plan('Staff: payments, department list', () => search.staffPayments(staff, {}));
    await plan('Staff: payments, amount range and channel', () =>
      search.staffPayments(staff, { minCents: '10000', maxCents: '10500', channel: 'CASH' }),
    );
  });

  it('citizen history', async () => {
    expect(
      await plan('Citizen: my applications', () => search.myApplications(citizen, {})),
    ).toContain('application_applicantId_createdAt_id_idx');
    await plan('Citizen: my payments', () => search.myPayments(citizen, {}));
  });
});
