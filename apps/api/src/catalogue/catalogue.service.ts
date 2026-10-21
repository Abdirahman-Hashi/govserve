import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AdminService,
  type CatalogueServiceDetail,
  type CatalogueServiceSummary,
  checkFormDefinition,
  type CreateServiceRequest,
  type FormValues,
  RequiredDocumentsSchema,
  type ServiceVersion as ServiceVersionDto,
  type UpdateServiceRequest,
  type UpdateVersionRequest,
  validateFormData,
} from '@govserve/shared';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { type RequestContext } from '../common/request-context';
import { Prisma, type ServiceVersion } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SUBJECT_FIELDS } from '../applications/form-data';
import { published, toAdminService, toDetail, toSummary, toVersionDto } from './catalogue.mapper';

const withRelations = { department: true, versions: { orderBy: { versionNo: 'desc' } } } as const;

/** Starting point for a brand-new service's first draft. */
const STARTER_FORM = {
  formSchema: {
    type: 'object',
    properties: { fullName: { type: 'string', title: 'Full name', minLength: 2, maxLength: 120 } },
    required: ['fullName'],
  },
  uiSchema: { order: ['fullName'] },
};

const actor = (u: AuthUser) => ({ id: u.id, role: u.role, type: 'USER' as const });
const notEditable = () =>
  new ConflictException({
    code: 'VERSION_NOT_EDITABLE',
    message: 'Only draft versions can be changed. Create a new draft instead.',
  });

/** How long a public catalogue answer may be reused (admin changes in this process clear it at once). */
export const PUBLIC_CACHE_MS = 30_000;

@Injectable()
export class CatalogueService {
  /**
   * The public catalogue was the most frequent query in the load test (every browsing visit) and
   * changes only when an admin edits a service or publishes/retires a version, so answers are kept
   * for PUBLIC_CACHE_MS. Searches are not cached (unbounded keys).
   */
  private readonly publicCache = new Map<string, { until: number; value: Promise<unknown> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Public (FR-023) ───────────────────────────────────────────────────────

  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.publicCache.get(key);
    if (hit && hit.until > Date.now()) return hit.value as Promise<T>;
    const value = load();
    this.publicCache.set(key, { until: Date.now() + PUBLIC_CACHE_MS, value });
    value.catch(() => this.publicCache.delete(key)); // never keep a failure (e.g. 404) around
    return value;
  }

  /** Called after every admin change that can alter what the public catalogue shows. */
  private clearPublicCache(): void {
    this.publicCache.clear();
  }

  async listPublic(q?: string): Promise<CatalogueServiceSummary[]> {
    const term = q?.trim();
    if (!term) return this.cached('list', () => this.loadPublicList());
    return this.loadPublicList(term);
  }

  private async loadPublicList(term?: string): Promise<CatalogueServiceSummary[]> {
    const services = await this.prisma.service.findMany({
      where: {
        active: true,
        versions: { some: { status: 'PUBLISHED' } },
        ...(term && {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
          ],
        }),
      },
      include: { department: true, versions: { where: { status: 'PUBLISHED' } } },
      orderBy: { name: 'asc' },
    });
    return services.map((s) => toSummary(s, published(s)!));
  }

  getPublic(code: string): Promise<CatalogueServiceDetail> {
    return this.cached(`code:${code}`, () => this.loadPublic(code));
  }

  private async loadPublic(code: string): Promise<CatalogueServiceDetail> {
    const service = await this.prisma.service.findUnique({
      where: { code },
      include: { department: true, versions: { where: { status: 'PUBLISHED' } } },
    });
    const version = service && published(service);
    if (!service || !service.active || !version) throw new NotFoundException();
    return toDetail(service, version);
  }

  /** Server-side validation of submitted form data against the exact version (FR-033). */
  async validateFormData(versionId: string, input: Record<string, unknown>): Promise<FormValues> {
    const version = await this.prisma.serviceVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    const check = checkFormDefinition(version.formSchema, version.uiSchema);
    if (!check.ok) throw new Error(`Service version ${versionId} has an invalid form definition`);
    const result = validateFormData(check.schema, input);
    if (!result.ok) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'Please correct the highlighted fields',
        details: Object.entries(result.errors).map(([path, message]) => ({ path, message })),
      });
    }
    return result.data;
  }

  // ─── Admin: services (FR-020) ──────────────────────────────────────────────

  async listAdmin(): Promise<AdminService[]> {
    const services = await this.prisma.service.findMany({
      include: withRelations,
      orderBy: { name: 'asc' },
    });
    return services.map(toAdminService);
  }

  async createService(
    user: AuthUser,
    body: CreateServiceRequest,
    ctx: RequestContext,
  ): Promise<AdminService> {
    const department = await this.prisma.department.findUniqueOrThrow({
      where: { code: body.departmentCode },
    });
    const { departmentCode: _ignored, ...fields } = body;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const service = await tx.service.create({
          data: {
            ...fields,
            departmentId: department.id,
            versions: {
              create: {
                versionNo: 1,
                ...STARTER_FORM,
                requiredDocuments: [],
                feeBaseCents: 0n,
                feePerCopyCents: 0n,
                createdById: user.id,
              },
            },
          },
          include: withRelations,
        });
        await this.audit.record(tx, {
          actor: actor(user),
          action: 'SERVICE_CREATED',
          entityType: 'Service',
          entityId: service.id,
          departmentId: department.id,
          after: { ...fields, departmentCode: body.departmentCode },
          ctx,
        });
        return service;
      });
      this.clearPublicCache();
      return toAdminService(created);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'SERVICE_EXISTS',
          message: 'A service with this code or certificate prefix already exists',
        });
      }
      throw err;
    }
  }

  async updateService(
    user: AuthUser,
    id: string,
    body: UpdateServiceRequest,
    ctx: RequestContext,
  ): Promise<AdminService> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await tx.service.findUnique({ where: { id } });
      if (!before) throw new NotFoundException();
      const service = await tx.service.update({
        where: { id },
        data: { ...body, version: { increment: 1 } },
        include: withRelations,
      });
      const keys = Object.keys(body) as (keyof UpdateServiceRequest)[];
      await this.audit.record(tx, {
        actor: actor(user),
        action: 'SERVICE_UPDATED',
        entityType: 'Service',
        entityId: id,
        departmentId: before.departmentId,
        before: Object.fromEntries(keys.map((k) => [k, before[k]])),
        after: Object.fromEntries(keys.map((k) => [k, service[k]])),
        ctx,
      });
      return service;
    });
    this.clearPublicCache();
    return toAdminService(updated);
  }

  // ─── Admin: versions (FR-021, FR-022) ──────────────────────────────────────

  async listVersions(serviceId: string): Promise<ServiceVersionDto[]> {
    const versions = await this.prisma.serviceVersion.findMany({
      where: { serviceId },
      orderBy: { versionNo: 'desc' },
    });
    if (
      versions.length === 0 &&
      !(await this.prisma.service.findUnique({ where: { id: serviceId } }))
    ) {
      throw new NotFoundException();
    }
    return versions.map(toVersionDto);
  }

  async getVersion(id: string): Promise<ServiceVersionDto> {
    const version = await this.prisma.serviceVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException();
    return toVersionDto(version);
  }

  /** "Editing" a published version: copy the latest version into a new draft. */
  async createDraft(
    user: AuthUser,
    serviceId: string,
    ctx: RequestContext,
  ): Promise<ServiceVersionDto> {
    try {
      const draft = await this.prisma.$transaction(async (tx) => {
        const latest = await tx.serviceVersion.findFirst({
          where: { serviceId },
          orderBy: { versionNo: 'desc' },
        });
        if (!latest) throw new NotFoundException();
        if (latest.status === 'DRAFT') throw draftExists();
        const created = await tx.serviceVersion.create({
          data: {
            serviceId,
            versionNo: latest.versionNo + 1,
            formSchema: latest.formSchema as Prisma.InputJsonValue,
            uiSchema: latest.uiSchema as Prisma.InputJsonValue,
            requiredDocuments: latest.requiredDocuments as Prisma.InputJsonValue,
            feeBaseCents: latest.feeBaseCents,
            feePerCopyCents: latest.feePerCopyCents,
            feeIsTest: latest.feeIsTest,
            createdById: user.id,
          },
        });
        await this.audit.record(tx, {
          actor: actor(user),
          action: 'SERVICE_VERSION_CREATED',
          entityType: 'ServiceVersion',
          entityId: created.id,
          after: { serviceId, versionNo: created.versionNo, copiedFrom: latest.versionNo },
          ctx,
        });
        return created;
      });
      return toVersionDto(draft);
    } catch (err) {
      // Two admins creating a draft at once: the partial unique index lets only one win.
      if (isUniqueViolation(err)) throw draftExists();
      throw err;
    }
  }

  async updateDraft(
    user: AuthUser,
    id: string,
    body: UpdateVersionRequest,
    ctx: RequestContext,
  ): Promise<ServiceVersionDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await this.versionOr404(tx, id);
      const changed = await tx.serviceVersion.updateMany({
        where: { id, status: 'DRAFT' },
        data: {
          ...(body.formSchema !== undefined && {
            formSchema: body.formSchema as Prisma.InputJsonValue,
          }),
          ...(body.uiSchema !== undefined && { uiSchema: body.uiSchema as Prisma.InputJsonValue }),
          ...(body.requiredDocuments !== undefined && {
            requiredDocuments: body.requiredDocuments,
          }),
          ...(body.fee !== undefined && {
            feeBaseCents: BigInt(body.fee.baseCents),
            feePerCopyCents: BigInt(body.fee.perCopyCents),
          }),
          ...(body.feeIsTest !== undefined && { feeIsTest: body.feeIsTest }),
        },
      });
      if (changed.count !== 1) throw notEditable();
      const after = await tx.serviceVersion.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        actor: actor(user),
        action: 'SERVICE_VERSION_UPDATED',
        entityType: 'ServiceVersion',
        entityId: id,
        // Areas changed, plus fee values (not personal data); the full schemas stay in the row.
        before: { versionNo: current.versionNo, ...feeAudit(current) },
        after: { versionNo: after.versionNo, changed: Object.keys(body), ...feeAudit(after) },
        ctx,
      });
      return after;
    });
    return toVersionDto(updated);
  }

  async deleteDraft(user: AuthUser, id: string, ctx: RequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.versionOr404(tx, id);
      const deleted = await tx.serviceVersion.deleteMany({ where: { id, status: 'DRAFT' } });
      if (deleted.count !== 1) throw notEditable();
      await this.audit.record(tx, {
        actor: actor(user),
        action: 'SERVICE_VERSION_DELETED',
        entityType: 'ServiceVersion',
        entityId: id,
        before: { serviceId: current.serviceId, versionNo: current.versionNo },
        ctx,
      });
    });
  }

  /**
   * Publishes a draft after validating it, retiring the previously published version in the
   * same transaction, so exactly one version is live (FR-022). Old versions stay intact for
   * the applications that reference them.
   */
  async publish(user: AuthUser, id: string, ctx: RequestContext): Promise<ServiceVersionDto> {
    const version = await this.prisma.$transaction(async (tx) => {
      const draft = await this.versionOr404(tx, id);
      if (draft.status !== 'DRAFT') throw notEditable();
      const service = await tx.service.findUniqueOrThrow({ where: { id: draft.serviceId } });
      const problems = validateForPublish(draft, service.subjectMode);
      if (problems.length > 0) {
        throw new UnprocessableEntityException({
          code: 'VERSION_INVALID',
          message: 'This version cannot be published until the problems are fixed',
          details: problems.map((message) => ({ path: 'version', message })),
        });
      }
      const now = new Date();
      const previous = await tx.serviceVersion.findFirst({
        where: { serviceId: draft.serviceId, status: 'PUBLISHED' },
      });
      if (previous) {
        await tx.serviceVersion.update({
          where: { id: previous.id },
          data: { status: 'RETIRED', retiredAt: now },
        });
        await this.audit.record(tx, {
          actor: actor(user),
          action: 'SERVICE_VERSION_RETIRED',
          entityType: 'ServiceVersion',
          entityId: previous.id,
          before: { versionNo: previous.versionNo, status: 'PUBLISHED' },
          after: { versionNo: previous.versionNo, status: 'RETIRED', replacedBy: draft.versionNo },
          ctx,
        });
      }
      const claimed = await tx.serviceVersion.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'PUBLISHED', publishedAt: now, publishedById: user.id },
      });
      if (claimed.count !== 1) throw notEditable();
      const live = await tx.serviceVersion.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        actor: actor(user),
        action: 'SERVICE_VERSION_PUBLISHED',
        entityType: 'ServiceVersion',
        entityId: id,
        before: { status: 'DRAFT', previousVersionNo: previous?.versionNo ?? null },
        after: { status: 'PUBLISHED', versionNo: live.versionNo, ...feeAudit(live) },
        ctx,
      });
      return live;
    });
    this.clearPublicCache();
    return toVersionDto(version);
  }

  /** Takes a service's live version offline without a replacement (new applications stop). */
  async retire(user: AuthUser, id: string, ctx: RequestContext): Promise<ServiceVersionDto> {
    const version = await this.prisma.$transaction(async (tx) => {
      const current = await this.versionOr404(tx, id);
      const changed = await tx.serviceVersion.updateMany({
        where: { id, status: 'PUBLISHED' },
        data: { status: 'RETIRED', retiredAt: new Date() },
      });
      if (changed.count !== 1) {
        throw new ConflictException({
          code: 'VERSION_NOT_PUBLISHED',
          message: 'Only the published version can be retired',
        });
      }
      await this.audit.record(tx, {
        actor: actor(user),
        action: 'SERVICE_VERSION_RETIRED',
        entityType: 'ServiceVersion',
        entityId: id,
        before: { versionNo: current.versionNo, status: 'PUBLISHED' },
        after: { versionNo: current.versionNo, status: 'RETIRED' },
        ctx,
      });
      return tx.serviceVersion.findUniqueOrThrow({ where: { id } });
    });
    this.clearPublicCache();
    return toVersionDto(version);
  }

  private async versionOr404(tx: Prisma.TransactionClient, id: string): Promise<ServiceVersion> {
    const version = await tx.serviceVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException();
    return version;
  }
}

/** Publish gate: the form definition, documents and fee rule must all be valid. */
export function validateForPublish(
  v: Pick<
    ServiceVersion,
    'formSchema' | 'uiSchema' | 'requiredDocuments' | 'feeBaseCents' | 'feePerCopyCents'
  >,
  subjectMode: 'SELF' | 'SELF_OR_CHILD' = 'SELF',
): string[] {
  const problems: string[] = [];
  const form = checkFormDefinition(v.formSchema, v.uiSchema);
  if (!form.ok) problems.push(...form.problems);
  // "Self or a child" services identify the subject from these fields (FR-031, FR-032).
  if (form.ok && subjectMode === 'SELF_OR_CHILD') {
    for (const name of SUBJECT_FIELDS) {
      if (!(name in form.schema.properties))
        problems.push(`Services for a child must have a "${name}" field`);
    }
    const rel = form.schema.properties['relationship'];
    if (rel && (rel.type !== 'string' || !rel.enum?.includes('SELF'))) {
      problems.push('The "relationship" field must be an options field that includes SELF');
    }
  }
  const docs = RequiredDocumentsSchema.safeParse(v.requiredDocuments);
  if (!docs.success)
    problems.push(
      ...docs.error.issues.map((i) => `requiredDocuments.${i.path.join('.')}: ${i.message}`),
    );
  if (v.feeBaseCents < 0n || v.feePerCopyCents < 0n) problems.push('Fees must not be negative');
  return problems;
}

function feeAudit(v: ServiceVersion) {
  return {
    feeBaseCents: v.feeBaseCents.toString(),
    feePerCopyCents: v.feePerCopyCents.toString(),
    feeIsTest: v.feeIsTest,
  };
}

function draftExists() {
  return new ConflictException({
    code: 'DRAFT_EXISTS',
    message: 'This service already has a draft version. Edit or delete it first.',
  });
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
