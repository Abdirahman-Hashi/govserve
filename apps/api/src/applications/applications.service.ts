import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type ApplicationAction,
  type ApplicationDetail,
  type ApplicationSummary,
  assessFee,
  checkFormDefinition,
  documentCompleteness,
  type FormSchema,
  type FormValues,
  type RequiredDocument,
  type UiSchema,
  type UpdateApplicationRequest,
  validateFormData,
} from '@govserve/shared';
import { type AuthUser } from '../auth/auth.types';
import { assertCitizenOwns } from '../common/guards/scope';
import { type RequestContext } from '../common/request-context';
import { CryptoService } from '../crypto/crypto.service';
import {
  type Application,
  type ApplicationData,
  type ApplicationStatusHistory,
  type Appointment,
  type Certificate,
  type CorrectionItem,
  type CorrectionRequest,
  type Document,
  type FeeAssessment,
  Prisma,
  type Service,
  type ServiceVersion,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PORT, type StoragePort } from '../storage/storage.port';
import { ApplicationStateService } from './application-state.service';
import { PAYMENT_EVIDENCE, toDocumentDto, USABLE_STATUSES } from '../documents/documents.mapper';
import { confirmedTotal, max } from '../payments/money';
import { paymentInclude, type PaymentWithReceipt, toPaymentDto } from '../payments/payment.mapper';
import { RefundsService } from '../payments/refunds.service';
import {
  childSubjectIdentity,
  NATIONAL_ID_FIELD,
  readFormValues,
  splitPii,
  subjectName,
} from './form-data';
import { claimExpiry, resume } from './sla';
import { certificateStatus } from '../certificates/certificate-status';
import { ConfigAdminService } from '../config-admin/config-admin.service';

type Full = Application & {
  service: Service;
  serviceVersion: ServiceVersion;
  data: ApplicationData | null;
  history: ApplicationStatusHistory[];
  documents: Document[];
  feeAssessment: FeeAssessment | null;
  payments: PaymentWithReceipt[];
  corrections: (CorrectionRequest & { items: CorrectionItem[] })[];
  appointments: Appointment[];
  certificates: Certificate[];
};

const include = {
  service: true,
  serviceVersion: true,
  data: true,
  history: { orderBy: { at: 'asc' } },
  // Payment evidence belongs to payments, not to the application's required documents.
  documents: {
    where: { supersededById: null, docType: { not: PAYMENT_EVIDENCE } },
    orderBy: { createdAt: 'asc' },
  },
  payments: { include: paymentInclude, orderBy: { createdAt: 'desc' } },
  feeAssessment: true,
  corrections: { where: { resolvedAt: null }, include: { items: true } },
  appointments: { orderBy: { createdAt: 'asc' } },
  certificates: { orderBy: { issuedAt: 'desc' }, take: 1 },
} as const satisfies Prisma.ApplicationInclude;

const OPEN_EXISTS = (existingId?: string) =>
  new ConflictException({
    code: 'OPEN_APPLICATION_EXISTS',
    message: 'You already have an open application for this service and person.',
    ...(existingId && { details: { applicationId: existingId } }),
  });

const notEditable = () =>
  new ConflictException({
    code: 'NOT_EDITABLE',
    message: 'This application cannot be changed now.',
  });

export interface Editability {
  /** null = every field/document may change (draft); [] = nothing may change. */
  fields: string[] | null;
  docTypes: string[] | null;
  extraCopies: boolean;
}

/** Citizen-side application lifecycle (FR-030–FR-039). Status changes go through ApplicationStateService. */
@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: ApplicationStateService,
    private readonly crypto: CryptoService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly refunds: RefundsService,
    private readonly settings: ConfigAdminService,
  ) {}

  // ─── A1: create a draft ─────────────────────────────────────────────────────

  async create(
    user: AuthUser,
    serviceCode: string,
    ctx: RequestContext,
  ): Promise<ApplicationDetail> {
    const service = await this.prisma.service.findUnique({
      where: { code: serviceCode },
      include: { versions: { where: { status: 'PUBLISHED' } } },
    });
    const version = service?.versions[0];
    if (!service || !service.active || !version)
      throw new NotFoundException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'This service is not available',
      });

    // Services that are only ever "for yourself" know the subject now (FR-031 applies at once).
    const self = service.subjectMode === 'SELF';
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const app = await tx.application.create({
          data: {
            applicantId: user.id,
            serviceId: service.id,
            serviceVersionId: version.id,
            departmentId: service.departmentId,
            ...(self && { subjectType: 'SELF', subjectKey: user.id, relationship: 'SELF' }),
            data: { create: {} },
          },
        });
        await this.state.record(tx, app, null, 'DRAFT', user, 'APPLICATION_CREATED', {
          ctx,
          details: { serviceCode, versionNo: version.versionNo },
        });
        return app.id;
      });
      return this.get(user, id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await this.prisma.application.findFirst({
          where: {
            applicantId: user.id,
            serviceId: service.id,
            subjectKey: user.id,
            status: { notIn: ['ISSUED', 'REJECTED', 'REFERRED', 'WITHDRAWN', 'ABANDONED'] },
          },
          select: { id: true },
        });
        throw OPEN_EXISTS(existing?.id);
      }
      throw err;
    }
  }

  // ─── Reads ──────────────────────────────────────────────────────────────────

  async get(user: AuthUser, id: string): Promise<ApplicationDetail> {
    return this.toDetail(user, await this.load(user, id));
  }

  // ─── Autosave (FR-030) and correction locking ──────────────────────────────

  async update(
    user: AuthUser,
    id: string,
    body: UpdateApplicationRequest,
  ): Promise<ApplicationDetail> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadIn(tx, user, id);
      const edit = editability(app);
      const schema = formSchemaOf(app.serviceVersion);

      if (body.extraCopies !== undefined && !edit.extraCopies) throw notEditable();
      if (body.formData) {
        const keys = Object.keys(body.formData);
        const unknown = keys.filter((k) => !(k in schema.properties));
        if (unknown.length > 0) {
          throw new UnprocessableEntityException({
            code: 'VALIDATION_FAILED',
            message: 'Some fields are not part of this form',
            details: unknown.map((k) => ({
              path: `formData.${k}`,
              message: 'This field is not part of the form',
            })),
          });
        }
        const locked = edit.fields === null ? [] : keys.filter((k) => !edit.fields!.includes(k));
        if (locked.length > 0) {
          throw new ConflictException({
            code: 'FIELD_LOCKED',
            message: 'Only the fields the officer asked you to correct can be changed.',
            details: locked.map((k) => ({
              path: `formData.${k}`,
              message: 'This field is locked',
            })),
          });
        }
        const merged = { ...this.readValues(app.data) };
        for (const [k, v] of Object.entries(body.formData)) {
          if (v === null || v === '') delete merged[k];
          else merged[k] = v;
        }
        await this.writeValues(tx, app.id, schema, merged);
      }
      // Touch the application so idle-draft purging (A4) sees the activity.
      await tx.application.update({
        where: { id: app.id },
        data: {
          ...(body.extraCopies !== undefined && { extraCopies: body.extraCopies }),
          updatedAt: new Date(),
        },
      });
    });
    return this.get(user, id);
  }

  // ─── A2: delete a draft ─────────────────────────────────────────────────────

  async remove(user: AuthUser, id: string, ctx: RequestContext): Promise<void> {
    const keys = await this.prisma.$transaction(async (tx) => {
      const app = await this.loadIn(tx, user, id);
      if (app.status !== 'DRAFT') throw notEditable();
      const docs = await tx.document.findMany({
        where: { applicationId: id },
        select: { storageKey: true },
      });
      await this.state.record(tx, app, 'DRAFT', null, user, 'APPLICATION_DRAFT_DELETED', { ctx });
      const deleted = await tx.application.deleteMany({
        where: { id, status: 'DRAFT', version: app.version },
      });
      if (deleted.count !== 1) throw notEditable();
      return docs.map((d) => d.storageKey);
    });
    await this.deleteObjects(keys);
  }

  // ─── A3: submit ─────────────────────────────────────────────────────────────

  async submit(user: AuthUser, id: string, ctx: RequestContext): Promise<ApplicationDetail> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const app = await this.loadIn(tx, user, id);
        this.state.assertAllowed({ application: app, to: 'AWAITING_PAYMENT', actor: user });
        const schema = formSchemaOf(app.serviceVersion);
        const required = app.serviceVersion.requiredDocuments as unknown as RequiredDocument[];

        const form = validateFormData(schema, this.readValues(app.data));
        const docs = documentCompleteness(
          required,
          app.documents
            .filter((d) => USABLE_STATUSES.includes(d.status))
            .map((d) => ({ docType: d.docType, status: d.status })),
        );
        if (!form.ok || !docs.ok) {
          throw new UnprocessableEntityException({
            code: 'VALIDATION_FAILED',
            message: 'Please complete the highlighted items before submitting.',
            details: [
              ...(form.ok
                ? []
                : Object.entries(form.errors).map(([k, message]) => ({
                    path: `formData.${k}`,
                    message,
                  }))),
              ...docs.missing.map((t) => ({
                path: `documents.${t}`,
                message: 'Upload this document',
              })),
              ...docs.notReady.map((t) => ({
                path: `documents.${t}`,
                message: 'This document is still being checked or was rejected',
              })),
            ],
          });
        }
        // Store the cleaned values (trimmed, inactive conditional answers removed).
        await this.writeValues(tx, app.id, schema, form.data);

        const subject = this.subjectFor(app, form.data);
        const [{ nextval }] = await tx.$queryRaw<
          [{ nextval: bigint }]
        >`SELECT nextval('application_ref_seq')`;
        const now = new Date();
        const referenceNo = `GS-${now.getUTCFullYear()}-${nextval.toString().padStart(6, '0')}`;

        const rule = {
          baseCents: app.serviceVersion.feeBaseCents,
          perCopyCents: app.serviceVersion.feePerCopyCents,
        };
        const fee = assessFee(rule, app.extraCopies);
        await tx.feeAssessment.create({
          data: {
            applicationId: app.id,
            lines: fee.lines.map((l) => ({
              ...l,
              unitCents: l.unitCents.toString(),
              amountCents: l.amountCents.toString(),
            })),
            totalCents: fee.totalCents,
            ruleSnapshot: {
              versionNo: app.serviceVersion.versionNo,
              baseCents: rule.baseCents.toString(),
              perCopyCents: rule.perCopyCents.toString(),
              feeIsTest: app.serviceVersion.feeIsTest,
            },
          },
        });
        await this.state.transition(tx, {
          application: app,
          to: 'AWAITING_PAYMENT',
          actor: user,
          ctx,
          data: { referenceNo, submittedAt: now, ...subject },
          details: { totalCents: fee.totalCents.toString(), extraCopies: app.extraCopies },
        });
      });
    } catch (err) {
      // FR-031 for child subjects is only known now: the partial unique index decides.
      if (isUniqueViolation(err)) throw OPEN_EXISTS();
      throw err;
    }
    return this.get(user, id);
  }

  // ─── A22: withdraw ──────────────────────────────────────────────────────────

  async withdraw(user: AuthUser, id: string, ctx: RequestContext): Promise<ApplicationDetail> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadIn(tx, user, id);
      await this.state.transition(tx, {
        application: app,
        to: 'WITHDRAWN',
        actor: user,
        ctx,
        data: { decidedAt: new Date() },
      });
      // A22 / FR-058: money is returned only if no officer had started reviewing (A8 never ran).
      const everClaimed = app.history.some((h) => h.toStatus === 'IN_REVIEW');
      if (!everClaimed)
        await this.refunds.requestForApplication(tx, app.id, 'WITHDRAWN_BEFORE_REVIEW');
      await tx.appointment.updateMany({
        where: { applicationId: app.id, status: 'SCHEDULED' },
        data: { status: 'CANCELLED' },
      });
    });
    return this.get(user, id);
  }

  // ─── A12: resubmit after corrections ────────────────────────────────────────

  async resubmit(user: AuthUser, id: string, ctx: RequestContext): Promise<ApplicationDetail> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadIn(tx, user, id);
      this.state.assertAllowed({ application: app, to: 'IN_REVIEW', actor: user });
      const request = app.corrections[0];
      if (!request) throw notEditable();
      const schema = formSchemaOf(app.serviceVersion);
      const values = this.readValues(app.data);
      const form = validateFormData(schema, values);
      const problems: { path: string; message: string }[] = form.ok
        ? []
        : Object.entries(form.errors).map(([k, message]) => ({ path: `formData.${k}`, message }));
      for (const item of request.items) {
        if (item.kind === 'FIELD') {
          const hash = this.crypto.keyedHash(
            'correction',
            JSON.stringify(values[item.target] ?? null),
          );
          if (hash === item.originalValueHash) {
            problems.push({ path: `formData.${item.target}`, message: 'Correct this answer' });
          }
        } else if (
          !app.documents.some(
            (d) =>
              d.docType === item.target && d.status === 'CLEAN' && d.createdAt > request.createdAt,
          )
        ) {
          problems.push({ path: `documents.${item.target}`, message: 'Upload a new document' });
        }
      }
      const docs = documentCompleteness(
        app.serviceVersion.requiredDocuments as unknown as RequiredDocument[],
        app.documents
          .filter((d) => USABLE_STATUSES.includes(d.status))
          .map((d) => ({ docType: d.docType, status: d.status })),
      );
      for (const t of [...docs.missing, ...docs.notReady]) {
        problems.push({ path: `documents.${t}`, message: 'This document is missing or not ready' });
      }
      if (!form.ok || problems.length > 0) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_FAILED',
          message: 'Please make the requested corrections before resubmitting.',
          details: problems,
        });
      }
      await this.writeValues(tx, app.id, schema, form.data);
      const now = new Date();
      await tx.correctionItem.updateMany({
        where: { correctionRequestId: request.id },
        data: { resolvedAt: now },
      });
      await tx.correctionRequest.update({ where: { id: request.id }, data: { resolvedAt: now } });
      const assignee = app.assigneeId
        ? await tx.user.findUnique({ where: { id: app.assigneeId }, select: { status: true } })
        : null;
      const resumed = await this.state.transition(tx, {
        application: app,
        to: 'IN_REVIEW',
        actor: user,
        ctx,
        data: {
          correctionDueAt: null,
          claimExpiresAt: await claimExpiry(tx, this.settings, now),
          ...resume(app, now),
        },
        details: { round: request.round },
      });
      // The officer who asked has left: back to the department queue (A9 by the system).
      if (assignee?.status !== 'ACTIVE') {
        await this.state.transition(tx, {
          application: resumed,
          to: 'QUEUED',
          actor: 'SYSTEM',
          note: 'Assignee no longer active',
          data: { assigneeId: null, claimExpiresAt: null },
        });
      }
    });
    return this.get(user, id);
  }

  // ─── A4: purge idle drafts (system job) ─────────────────────────────────────

  async abandonIdleDrafts(draftDays: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - draftDays * 86_400_000);
    const stale = await this.prisma.application.findMany({
      where: { status: 'DRAFT', updatedAt: { lt: cutoff } },
      take: 200,
    });
    let count = 0;
    for (const app of stale) {
      const keys = await this.prisma
        .$transaction(async (tx) => {
          await this.state.transition(tx, {
            application: app,
            to: 'ABANDONED',
            actor: 'SYSTEM',
            note: `Idle for more than ${draftDays} days`,
          });
          const docs = await tx.document.findMany({
            where: { applicationId: app.id, purgedAt: null },
          });
          await tx.document.updateMany({
            where: { applicationId: app.id },
            data: { purgedAt: now },
          });
          return docs.map((d) => d.storageKey);
        })
        .catch((err: unknown) => {
          // Another process touched it meanwhile; skip it this run.
          if (err instanceof ConflictException) return null;
          throw err;
        });
      if (keys) {
        await this.deleteObjects(keys);
        count += 1;
      }
    }
    return count;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async load(user: AuthUser, id: string): Promise<Full> {
    return this.loadIn(this.prisma, user, id);
  }

  private async loadIn(db: Prisma.TransactionClient, user: AuthUser, id: string): Promise<Full> {
    const app = await db.application.findUnique({ where: { id }, include });
    if (!app) throw new NotFoundException();
    assertCitizenOwns(user, app.applicantId);
    return app;
  }

  readValues(data: ApplicationData | null): FormValues {
    return readFormValues(this.crypto, data);
  }

  private async writeValues(
    tx: Prisma.TransactionClient,
    applicationId: string,
    schema: FormSchema,
    values: FormValues,
  ): Promise<void> {
    const { plain, pii } = splitPii(schema, values);
    const nationalId = values[NATIONAL_ID_FIELD];
    await tx.applicationData.update({
      where: { applicationId },
      data: {
        data: plain,
        piiEnc: Object.keys(pii).length > 0 ? this.crypto.encrypt(JSON.stringify(pii)) : null,
        subjectFullName: subjectName(values),
        subjectNationalIdBidx:
          typeof nationalId === 'string' ? this.crypto.blindIndex('nationalId', nationalId) : null,
      },
    });
  }

  private subjectFor(app: Full, values: FormValues): Prisma.ApplicationUncheckedUpdateManyInput {
    if (app.service.subjectMode === 'SELF') return {};
    const relationship = values['relationship'];
    if (relationship === 'SELF')
      return { subjectType: 'SELF', subjectKey: app.applicantId, relationship: 'SELF' };
    return {
      subjectType: 'CHILD',
      relationship: relationship as 'MOTHER' | 'FATHER' | 'GUARDIAN',
      subjectKey: this.crypto.keyedHash('subject', childSubjectIdentity(values)),
    };
  }

  private async deleteObjects(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.storage
        .delete(key)
        .catch((err: unknown) =>
          this.logger.warn({ err: (err as Error).name }, 'Failed to delete stored object'),
        );
    }
  }

  private toDetail(user: AuthUser, app: Full): ApplicationDetail {
    const schema = formSchemaOf(app.serviceVersion);
    const edit = editability(app);
    const open = app.corrections[0];
    const paid = confirmedTotal(app.payments);
    return {
      ...toSummary(app, app.service),
      kind: app.kind,
      extraCopies: app.extraCopies,
      serviceVersionId: app.serviceVersionId,
      formSchema: schema,
      uiSchema: app.serviceVersion.uiSchema as unknown as UiSchema,
      requiredDocuments: app.serviceVersion.requiredDocuments as unknown as RequiredDocument[],
      fee: {
        baseCents: app.serviceVersion.feeBaseCents.toString(),
        perCopyCents: app.serviceVersion.feePerCopyCents.toString(),
      },
      feeProvisional: app.serviceVersion.feeIsTest,
      formData: this.readValues(app.data),
      documents: app.documents.filter((d) => d.status !== 'PENDING_UPLOAD').map(toDocumentDto),
      history: app.history.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        at: h.at.toISOString(),
        note: h.note,
      })),
      feeAssessment: app.feeAssessment
        ? {
            lines: app.feeAssessment.lines as NonNullable<
              ApplicationDetail['feeAssessment']
            >['lines'],
            totalCents: app.feeAssessment.totalCents.toString(),
          }
        : null,
      payments: app.payments.map(toPaymentDto),
      paidCents: paid.toString(),
      balanceCents: (app.feeAssessment
        ? max(app.feeAssessment.totalCents - paid, 0n)
        : 0n
      ).toString(),
      appointments: app.appointments.map((ap) => ({
        kind: ap.kind,
        scheduledAt: ap.scheduledAt.toISOString(),
        location: ap.location,
        status: ap.status,
      })),
      certificate: app.certificates[0]
        ? {
            id: app.certificates[0].id,
            certificateNo: app.certificates[0].certificateNo,
            status: certificateStatus(app.certificates[0]),
            issuedAt: app.certificates[0].issuedAt.toISOString(),
            expiresAt: app.certificates[0].expiresAt?.toISOString() ?? null,
          }
        : null,
      allowedActions: allowedActions(this.state, app, user),
      editableFields: edit.fields,
      editableDocTypes: edit.docTypes,
      correction: open
        ? {
            round: open.round,
            dueAt: open.dueAt.toISOString(),
            items: open.items.map((i) => ({ kind: i.kind, target: i.target, comment: i.comment })),
          }
        : null,
    };
  }
}

export function formSchemaOf(version: ServiceVersion): FormSchema {
  const check = checkFormDefinition(version.formSchema, version.uiSchema);
  if (!check.ok) throw new Error(`Service version ${version.id} has an invalid form definition`);
  return check.schema;
}

/** What can change: everything in a draft; only flagged items during a correction. */
export function editability(
  app: Pick<Application, 'status'> & { corrections: { items: CorrectionItem[] }[] },
): Editability {
  if (app.status === 'DRAFT') return { fields: null, docTypes: null, extraCopies: true };
  if (app.status === 'CORRECTION_REQUESTED') {
    const items = app.corrections.flatMap((c) => c.items).filter((i) => !i.resolvedAt);
    return {
      fields: items.filter((i) => i.kind === 'FIELD').map((i) => i.target),
      docTypes: items.filter((i) => i.kind === 'DOCUMENT').map((i) => i.target),
      extraCopies: false,
    };
  }
  return { fields: [], docTypes: [], extraCopies: false };
}

function allowedActions(
  state: ApplicationStateService,
  app: Full,
  user: AuthUser,
): ApplicationAction[] {
  const can = (to: Application['status']) => {
    try {
      state.assertAllowed({ application: app, to, actor: user });
      return true;
    } catch {
      return false;
    }
  };
  const actions: ApplicationAction[] = [];
  if (app.status === 'DRAFT') actions.push('EDIT', 'DELETE');
  if (can('AWAITING_PAYMENT')) actions.push('SUBMIT');
  if (app.status === 'CORRECTION_REQUESTED') actions.push('EDIT');
  if (can('IN_REVIEW')) actions.push('RESUBMIT');
  if (can('WITHDRAWN')) actions.push('WITHDRAW');
  return actions;
}

function toSummary(app: Application, service: Service): ApplicationSummary {
  return {
    id: app.id,
    referenceNo: app.referenceNo,
    serviceCode: service.code,
    serviceName: service.name,
    status: app.status,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    submittedAt: app.submittedAt?.toISOString() ?? null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
