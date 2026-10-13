import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type FormValues,
  listPiiFields,
  type QueueItem,
  type QueueQuery,
  type RecordAppointmentRequest,
  type RequestCorrectionRequest,
  type RequiredDocument,
  type ResolveChargebackRequest,
  type ScheduleAppointmentRequest,
  slaRisk,
  type StaffAction,
  type StaffApplication,
} from '@govserve/shared';
import { ApplicationStateService } from '../applications/application-state.service';
import { formSchemaOf } from '../applications/applications.service';
import { readFormValues } from '../applications/form-data';
import { claimExpiry, pause, resume, stopSla } from '../applications/sla';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { CertificatesService, toCertificateSummary } from '../certificates/certificates.service';
import { assertSameDepartment } from '../common/guards/scope';
import { type RequestContext } from '../common/request-context';
import { ConfigAdminService } from '../config-admin/config-admin.service';
import { CryptoService } from '../crypto/crypto.service';
import {
  type Application,
  type ApplicationStatus,
  Prisma,
  type Service,
} from '../generated/prisma/client';
import { confirmedTotal } from '../payments/money';
import { paymentInclude, toPaymentDto } from '../payments/payment.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { toDocumentDto, PAYMENT_EVIDENCE } from '../documents/documents.mapper';

const MASK = '••••';
const OPEN_FOR_STAFF: ApplicationStatus[] = [
  'QUEUED',
  'IN_REVIEW',
  'CORRECTION_REQUESTED',
  'AWAITING_APPOINTMENT',
  'AWAITING_SUPERVISOR',
];

const detailInclude = {
  service: true,
  serviceVersion: true,
  data: true,
  applicant: { select: { fullName: true } },
  assignee: { select: { fullName: true } },
  documents: {
    where: {
      supersededById: null,
      docType: { not: PAYMENT_EVIDENCE },
      status: { not: 'PENDING_UPLOAD' },
    },
    orderBy: { createdAt: 'asc' },
  },
  feeAssessment: true,
  payments: { include: paymentInclude, orderBy: { createdAt: 'desc' } },
  history: { orderBy: { at: 'asc' } },
  appointments: { orderBy: { createdAt: 'asc' } },
  decisions: { orderBy: { decidedAt: 'asc' } },
  corrections: { include: { items: true }, orderBy: { round: 'asc' } },
  certificates: {
    where: { duplicateOfId: null },
    include: { service: true },
    orderBy: { issuedAt: 'desc' },
  },
} as const satisfies Prisma.ApplicationInclude;

type Full = Prisma.ApplicationGetPayload<{ include: typeof detailInclude }>;

const stale = () =>
  new ConflictException({
    code: 'CONCURRENT_UPDATE',
    message: 'This application was changed by someone else. Reload and try again.',
  });

/**
 * Officer review (FR-070–FR-080). Every status change goes through ApplicationStateService;
 * staff actions carry the version they saw, so two people cannot act on stale data.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: ApplicationStateService,
    private readonly certificates: CertificatesService,
    private readonly settings: ConfigAdminService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ─── Queue (FR-070, FR-071) ────────────────────────────────────────────────

  async queue(user: AuthUser, q: QueueQuery, now = new Date()): Promise<QueueItem[]> {
    const where: Prisma.ApplicationWhereInput = {
      departmentId: user.departmentId ?? '',
      status: q.status ? q.status : { in: q.assignee ? OPEN_FOR_STAFF : ['QUEUED'] },
      ...(q.service && { service: { code: q.service } }),
      ...(q.assignee === 'me' && { assigneeId: user.id }),
      ...(q.assignee === 'unassigned' && { assigneeId: null }),
      ...(q.assignee &&
        q.assignee !== 'me' &&
        q.assignee !== 'unassigned' && { assigneeId: q.assignee }),
    };
    const rows = await this.prisma.application.findMany({
      where,
      include: {
        service: true,
        applicant: { select: { fullName: true } },
        assignee: { select: { fullName: true } },
      },
      orderBy: [{ slaDueAt: { sort: 'asc', nulls: 'last' } }, { submittedAt: 'asc' }],
      take: 300,
    });
    const items = rows.map((a): QueueItem => ({
      id: a.id,
      referenceNo: a.referenceNo,
      serviceCode: a.service.code,
      serviceName: a.service.name,
      applicantName: a.applicant.fullName,
      status: a.status,
      assigneeId: a.assigneeId,
      assigneeName: a.assignee?.fullName ?? null,
      submittedAt: a.submittedAt?.toISOString() ?? null,
      slaDueAt: a.slaDueAt?.toISOString() ?? null,
      slaRisk: riskOf(a, now),
      chargebackFlag: a.chargebackFlag,
    }));
    return q.risk ? items.filter((i) => i.slaRisk === q.risk) : items;
  }

  /** A8 on the most urgent unclaimed application; retries if someone else wins the race. */
  async claimNext(user: AuthUser, ctx: RequestContext): Promise<StaffApplication> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const next = await this.prisma.application.findFirst({
        where: { departmentId: user.departmentId ?? '', status: 'QUEUED' },
        orderBy: [{ slaDueAt: { sort: 'asc', nulls: 'last' } }, { submittedAt: 'asc' }],
      });
      if (!next)
        throw new NotFoundException({
          code: 'QUEUE_EMPTY',
          message: 'There is nothing waiting in your queue.',
        });
      try {
        return await this.claim(user, next.id, next.version, ctx);
      } catch (err) {
        if (!(err instanceof ConflictException)) throw err;
      }
    }
    throw stale();
  }

  async claim(
    user: AuthUser,
    id: string,
    version: number,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadIn(tx, user, id, version);
      await this.state.transition(tx, {
        application: app,
        to: 'IN_REVIEW',
        actor: user,
        ctx,
        data: { assigneeId: user.id, claimExpiresAt: await this.claimExpiry(tx) },
      });
    });
    return this.detail(user, id);
  }

  /** A9 by the assignee or a supervisor. */
  async release(
    user: AuthUser,
    id: string,
    version: number,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadIn(tx, user, id, version);
      await this.state.transition(tx, {
        application: app,
        to: 'QUEUED',
        actor: user,
        ctx,
        data: { assigneeId: null, claimExpiresAt: null },
      });
    });
    return this.detail(user, id);
  }

  /** A10 (or A8 on behalf of an officer): supervisor assigns or reassigns work. */
  async assign(
    user: AuthUser,
    id: string,
    version: number,
    officerId: string,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    if (user.role !== 'SUPERVISOR')
      throw new ForbiddenException({
        code: 'SUPERVISOR_ONLY',
        message: 'Only a supervisor can assign work.',
      });
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadIn(tx, user, id, version);
      const officer = await tx.user.findUnique({ where: { id: officerId } });
      if (
        !officer ||
        officer.status !== 'ACTIVE' ||
        !['OFFICER', 'SUPERVISOR'].includes(officer.role) ||
        officer.departmentId !== app.departmentId
      ) {
        throw new UnprocessableEntityException({
          code: 'INVALID_ASSIGNEE',
          message: 'Choose an active officer of this department.',
        });
      }
      const claimExpiresAt = await this.claimExpiry(tx);
      if (app.status === 'QUEUED') {
        await this.state.transition(tx, {
          application: app,
          to: 'IN_REVIEW',
          actor: user,
          ctx,
          data: { assigneeId: officerId, claimExpiresAt },
          details: { assignedTo: officerId },
        });
        return;
      }
      if (!OPEN_FOR_STAFF.includes(app.status)) throw this.invalid(app.status);
      const changed = await tx.application.updateMany({
        where: { id, version: app.version },
        data: { assigneeId: officerId, claimExpiresAt, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw stale();
      await this.state.record(tx, app, app.status, null, user, 'APPLICATION_REASSIGNED', {
        ctx,
        details: { from: app.assigneeId ?? 'unassigned', to: officerId },
      });
    });
    return this.detail(user, id);
  }

  // ─── Review detail (FR-072) ────────────────────────────────────────────────

  async detail(user: AuthUser, id: string, now = new Date()): Promise<StaffApplication> {
    const app = await this.prisma.application.findUnique({ where: { id }, include: detailInclude });
    if (!app) throw new NotFoundException();
    assertSameDepartment(user, app.departmentId);
    const schema = formSchemaOf(app.serviceVersion);
    const values = readFormValues(this.crypto, app.data);
    const pii = new Set(listPiiFields(schema));
    const masked: FormValues = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, pii.has(k) ? MASK : v]),
    );
    const actorIds = [
      ...new Set(
        [...app.history.map((h) => h.actorId), ...app.decisions.map((d) => d.decidedById)].filter(
          (x): x is string => !!x,
        ),
      ),
    ];
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, fullName: true },
        })
      ).map((u) => [u.id, u.fullName]),
    );
    const cert = app.certificates[0];
    return {
      id: app.id,
      referenceNo: app.referenceNo,
      kind: app.kind,
      serviceCode: app.service.code,
      serviceName: app.service.name,
      approvalMode: app.service.approvalMode,
      inPersonStep: app.service.inPersonStep,
      status: app.status,
      version: app.version,
      applicantName: app.applicant.fullName,
      subjectType: app.subjectType,
      relationship: app.relationship,
      assigneeId: app.assigneeId,
      assigneeName: app.assignee?.fullName ?? null,
      claimExpiresAt: app.claimExpiresAt?.toISOString() ?? null,
      submittedAt: app.submittedAt?.toISOString() ?? null,
      slaDueAt: app.slaDueAt?.toISOString() ?? null,
      slaRisk: riskOf(app, now),
      correctionRound: app.correctionRound,
      chargebackFlag: app.chargebackFlag,
      formSchema: schema,
      uiSchema: app.serviceVersion.uiSchema as StaffApplication['uiSchema'],
      formData: masked,
      maskedFields: Object.keys(values).filter((k) => pii.has(k)),
      requiredDocuments: app.serviceVersion.requiredDocuments as unknown as RequiredDocument[],
      documents: app.documents.map(toDocumentDto),
      feeAssessment: app.feeAssessment
        ? {
            lines: app.feeAssessment.lines as unknown as NonNullable<
              StaffApplication['feeAssessment']
            >['lines'],
            totalCents: app.feeAssessment.totalCents.toString(),
          }
        : null,
      payments: app.payments.map(toPaymentDto),
      paidCents: confirmedTotal(app.payments).toString(),
      history: app.history.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        at: h.at.toISOString(),
        note: h.note,
        actorName: h.actorId ? (names.get(h.actorId) ?? null) : null,
      })),
      appointments: app.appointments.map((a) => ({
        id: a.id,
        kind: a.kind,
        scheduledAt: a.scheduledAt.toISOString(),
        location: a.location,
        status: a.status,
        attendees: (a.attendees as { name: string; role: string }[] | null) ?? null,
        rescheduleCount: a.rescheduleCount,
      })),
      decisions: app.decisions.map((d) => ({
        level: d.level,
        decision: d.decision,
        outcome: d.outcome,
        note: d.note,
        decidedById: d.decidedById,
        decidedByName: names.get(d.decidedById) ?? '',
        decidedAt: d.decidedAt.toISOString(),
      })),
      corrections: app.corrections.map((c) => ({
        round: c.round,
        dueAt: c.dueAt.toISOString(),
        resolvedAt: c.resolvedAt?.toISOString() ?? null,
        items: c.items.map((i) => ({ kind: i.kind, target: i.target, comment: i.comment })),
      })),
      certificate: cert ? toCertificateSummary(cert) : null,
      allowedActions: this.allowedActions(user, app),
      approvalBlockers: approvalBlockers(app),
    };
  }

  /** FR-072: personal fields in clear, audited. */
  async unmask(user: AuthUser, id: string, ctx: RequestContext): Promise<{ formData: FormValues }> {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: { data: true },
    });
    if (!app) throw new NotFoundException();
    assertSameDepartment(user, app.departmentId);
    await this.prisma.$transaction((tx) =>
      this.state.record(tx, app, app.status, null, user, 'APPLICATION_PII_VIEWED', { ctx }),
    );
    return { formData: readFormValues(this.crypto, app.data) };
  }

  // ─── Officer actions ───────────────────────────────────────────────────────

  /** A11: flag fields/documents; at most 3 rounds; 30-day deadline; SLA paused. */
  async requestCorrection(
    user: AuthUser,
    id: string,
    body: RequestCorrectionRequest,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, body.version);
      const maxRounds = await this.settings.get('correction.maxRounds');
      if (app.correctionRound >= maxRounds) {
        throw new ConflictException({
          code: 'MAX_CORRECTION_ROUNDS',
          message: `An application can be sent back for corrections at most ${maxRounds} times.`,
        });
      }
      const schema = formSchemaOf(app.serviceVersion);
      const docTypes = (app.serviceVersion.requiredDocuments as unknown as RequiredDocument[]).map(
        (d) => d.type,
      );
      const bad = body.items.filter((i) =>
        i.kind === 'FIELD' ? !(i.target in schema.properties) : !docTypes.includes(i.target),
      );
      if (bad.length > 0) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_FAILED',
          message: 'Some flagged items are not part of this application',
          details: bad.map((i) => ({ path: i.target, message: 'Unknown field or document' })),
        });
      }
      const values = readFormValues(this.crypto, app.data);
      const now = new Date();
      const days = await this.settings.get('correction.deadlineDays');
      const dueAt = new Date(now.getTime() + days * 86_400_000);
      const round = app.correctionRound + 1;
      await tx.correctionRequest.create({
        data: {
          applicationId: id,
          round,
          requestedById: user.id,
          dueAt,
          items: {
            create: body.items.map((i) => ({
              kind: i.kind,
              target: i.target,
              comment: i.comment,
              originalValueHash:
                i.kind === 'FIELD'
                  ? this.crypto.keyedHash('correction', JSON.stringify(values[i.target] ?? null))
                  : null,
            })),
          },
        },
      });
      await this.state.transition(tx, {
        application: app,
        to: 'CORRECTION_REQUESTED',
        actor: user,
        ctx,
        data: {
          correctionRound: round,
          correctionDueAt: dueAt,
          claimExpiresAt: null,
          ...pause(app, now),
        },
        details: { round, items: body.items.length },
      });
    });
    return this.detail(user, id);
  }

  /** A14: book the in-person step (fingerprints / appearance); SLA paused. */
  async scheduleAppointment(
    user: AuthUser,
    id: string,
    body: ScheduleAppointmentRequest,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, body.version);
      if (app.service.inPersonStep === 'NONE')
        throw new ConflictException({
          code: 'NO_IN_PERSON_STEP',
          message: 'This service has no in-person step.',
        });
      const scheduledAt = new Date(body.scheduledAt);
      if (scheduledAt.getTime() < Date.now())
        throw new UnprocessableEntityException({
          code: 'VALIDATION_FAILED',
          message: 'Choose a time in the future',
          details: [{ path: 'scheduledAt', message: 'Must be in the future' }],
        });
      const previous = app.appointments.filter((a) => a.status === 'NO_SHOW').length;
      const maxReschedules = await this.settings.get('appointment.maxReschedules');
      if (previous > maxReschedules) {
        throw new ConflictException({
          code: 'MAX_RESCHEDULES',
          message: 'The appointment cannot be rescheduled again. Reject the application instead.',
        });
      }
      await tx.appointment.create({
        data: {
          applicationId: id,
          kind: app.service.inPersonStep,
          scheduledAt,
          location: body.location,
          scheduledById: user.id,
          rescheduleCount: previous,
        },
      });
      await this.state.transition(tx, {
        application: app,
        to: 'AWAITING_APPOINTMENT',
        actor: user,
        ctx,
        data: { ...pause(app, new Date()), claimExpiresAt: null },
        details: { scheduledAt: scheduledAt.toISOString(), kind: app.service.inPersonStep },
      });
    });
    return this.detail(user, id);
  }

  /** A15: record attendance after the appointment time; SLA resumes. */
  async recordAppointment(
    user: AuthUser,
    id: string,
    body: RecordAppointmentRequest,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, body.version);
      const appt = app.appointments.find((a) => a.status === 'SCHEDULED');
      if (!appt)
        throw new ConflictException({
          code: 'NO_APPOINTMENT',
          message: 'There is no scheduled appointment.',
        });
      const now = new Date();
      if (appt.scheduledAt > now)
        throw new ConflictException({
          code: 'APPOINTMENT_NOT_YET',
          message: 'Record attendance after the appointment time.',
        });
      if (
        body.outcome === 'ATTENDED' &&
        app.service.inPersonStep === 'APPEARANCE' &&
        !body.attendees?.length
      ) {
        throw new UnprocessableEntityException({
          code: 'VALIDATION_FAILED',
          message: 'Record who appeared',
          details: [{ path: 'attendees', message: 'Add at least one person' }],
        });
      }
      await tx.appointment.update({
        where: { id: appt.id },
        data: {
          status: body.outcome,
          recordedById: user.id,
          recordedAt: now,
          ...(body.attendees && { attendees: body.attendees }),
        },
      });
      await this.state.transition(tx, {
        application: app,
        to: 'IN_REVIEW',
        actor: user,
        ctx,
        data: { ...resume(app, now), claimExpiresAt: await this.claimExpiry(tx) },
        details: { outcome: body.outcome },
      });
    });
    return this.detail(user, id);
  }

  /**
   * Officer approval: SINGLE (address; police "no record") issues the certificate (A16);
   * SUPERVISOR_SECOND (birth) forwards for a second approval (A17).
   */
  async approve(
    user: AuthUser,
    id: string,
    version: number,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, version);
      this.assertCanApprove(app);
      const twoStep = app.service.approvalMode === 'SUPERVISOR_SECOND';
      const outcome =
        app.service.approvalMode === 'SUPERVISOR_ON_RECORD_FOUND' ? 'NO_RECORD' : null;
      await tx.reviewDecision.create({
        data: {
          applicationId: id,
          level: 'OFFICER',
          decision: twoStep ? 'FORWARD' : 'APPROVE',
          outcome,
          decidedById: user.id,
        },
      });
      if (twoStep) {
        await this.state.transition(tx, {
          application: app,
          to: 'AWAITING_SUPERVISOR',
          actor: user,
          ctx,
          data: { claimExpiresAt: null },
        });
        return;
      }
      await this.state.transition(tx, {
        application: app,
        to: 'ISSUED',
        actor: user,
        ctx,
        data: {
          reviewOutcome: outcome,
          decidedAt: new Date(),
          claimExpiresAt: null,
          ...stopSla(app),
        },
      });
      await this.certificates.issue(tx, app, user);
    });
    return this.detail(user, id);
  }

  /** A17 (police): record found. The note is encrypted and never shown online or emailed. */
  async refer(
    user: AuthUser,
    id: string,
    version: number,
    note: string,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, version);
      if (app.service.approvalMode !== 'SUPERVISOR_ON_RECORD_FOUND') {
        throw new ConflictException({
          code: 'NOT_REFERRABLE',
          message: 'Only police clearance applications can be referred.',
        });
      }
      if (!app.appointments.some((a) => a.status === 'ATTENDED')) {
        throw new ConflictException({
          code: 'APPOINTMENT_REQUIRED',
          message: 'Fingerprints must be taken before deciding.',
        });
      }
      await tx.reviewDecision.create({
        data: {
          applicationId: id,
          level: 'OFFICER',
          decision: 'FORWARD',
          outcome: 'RECORD_FOUND',
          noteEnc: this.crypto.encrypt(note),
          decidedById: user.id,
        },
      });
      await this.state.transition(tx, {
        application: app,
        to: 'AWAITING_SUPERVISOR',
        actor: user,
        ctx,
        data: { reviewOutcome: 'RECORD_FOUND', claimExpiresAt: null },
      });
    });
    return this.detail(user, id);
  }

  /** A21 by the assignee (IN_REVIEW) or a supervisor (AWAITING_SUPERVISOR). */
  async reject(
    user: AuthUser,
    id: string,
    version: number,
    reasonCode: string,
    note: string,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, version);
      const reason = await tx.reasonCode.findUnique({
        where: { kind_code: { kind: 'REJECT', code: reasonCode } },
      });
      if (!reason?.active)
        throw new UnprocessableEntityException({
          code: 'VALIDATION_FAILED',
          message: 'Choose a valid reason',
          details: [{ path: 'reasonCode', message: 'Unknown reason' }],
        });
      await tx.reviewDecision.create({
        data: {
          applicationId: id,
          level: app.status === 'AWAITING_SUPERVISOR' ? 'SUPERVISOR' : 'OFFICER',
          decision: 'REJECT',
          reasonCodeId: reason.id,
          note,
          decidedById: user.id,
        },
      });
      await this.state.transition(tx, {
        application: app,
        to: 'REJECTED',
        actor: user,
        ctx,
        note,
        data: { decidedAt: new Date(), claimExpiresAt: null, ...stopSla(app) },
        details: { reasonCode },
      });
    });
    return this.detail(user, id);
  }

  // ─── Supervisor actions ────────────────────────────────────────────────────

  /** A18: second approval by a different person; issues the certificate. */
  async secondApprove(
    user: AuthUser,
    id: string,
    version: number,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, version);
      this.assertSecondPerson(user, app);
      if (app.reviewOutcome === 'RECORD_FOUND')
        throw new ConflictException({
          code: 'RECORD_FOUND',
          message: 'A record was found: confirm the referral or return it.',
        });
      this.assertCanApprove(app, ['AWAITING_SUPERVISOR']);
      await this.supervisorDecision(tx, id, 'APPROVE', user);
      await this.state.transition(tx, {
        application: app,
        to: 'ISSUED',
        actor: user,
        ctx,
        data: { decidedAt: new Date(), ...stopSla(app) },
      });
      await this.certificates.issue(tx, app, user);
    });
    return this.detail(user, id);
  }

  /** A19: police record found confirmed; no certificate; the citizen is told only to visit CID. */
  async confirmReferral(
    user: AuthUser,
    id: string,
    version: number,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, version);
      this.assertSecondPerson(user, app);
      if (app.reviewOutcome !== 'RECORD_FOUND')
        throw new ConflictException({
          code: 'NO_RECORD_FOUND',
          message: 'Only a "record found" outcome can be referred.',
        });
      await this.supervisorDecision(tx, id, 'REFER', user);
      await this.state.transition(tx, {
        application: app,
        to: 'REFERRED',
        actor: user,
        ctx,
        data: { decidedAt: new Date(), ...stopSla(app) },
      });
    });
    return this.detail(user, id);
  }

  /** A20: back to the officer with a note. */
  async returnToOfficer(
    user: AuthUser,
    id: string,
    version: number,
    note: string,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, version);
      await this.supervisorDecision(tx, id, 'RETURN', user, note);
      await this.state.transition(tx, {
        application: app,
        to: 'IN_REVIEW',
        actor: user,
        ctx,
        note,
        data: { reviewOutcome: null, claimExpiresAt: await this.claimExpiry(tx) },
      });
    });
    return this.detail(user, id);
  }

  /** §1.2: supervisor keeps or revokes after a card chargeback. */
  async resolveChargeback(
    user: AuthUser,
    id: string,
    body: ResolveChargebackRequest,
    ctx: RequestContext,
  ): Promise<StaffApplication> {
    if (user.role !== 'SUPERVISOR')
      throw new ForbiddenException({
        code: 'SUPERVISOR_ONLY',
        message: 'Only a supervisor can resolve chargebacks.',
      });
    await this.prisma.$transaction(async (tx) => {
      const app = await this.loadFullIn(tx, user, id, body.version);
      if (!app.chargebackFlag)
        throw new ConflictException({
          code: 'NO_CHARGEBACK',
          message: 'This application has no open chargeback.',
        });
      if (body.decision === 'REVOKE') {
        const cert = app.certificates.find((c) => c.status === 'VALID');
        if (cert)
          await this.certificates.revokeIn(
            tx,
            cert,
            'CHARGEBACK',
            body.note,
            user,
            app.departmentId,
            ctx,
          );
      }
      const changed = await tx.application.updateMany({
        where: { id, version: app.version },
        data: { chargebackFlag: false, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw stale();
      await this.state.record(tx, app, app.status, null, user, 'APPLICATION_CHARGEBACK_RESOLVED', {
        ctx,
        details: { decision: body.decision },
      });
    });
    return this.detail(user, id);
  }

  // ─── Jobs ───────────────────────────────────────────────────────────────────

  /** A9 by the system: claims idle past the expiry return to the queue. */
  async expireClaims(now = new Date()): Promise<number> {
    const expired = await this.prisma.application.findMany({
      where: { status: 'IN_REVIEW', claimExpiresAt: { lt: now } },
      take: 200,
    });
    let count = 0;
    for (const app of expired) {
      await this.prisma
        .$transaction((tx) =>
          this.state.transition(tx, {
            application: app,
            to: 'QUEUED',
            actor: 'SYSTEM',
            note: 'Claim expired',
            data: { assigneeId: null, claimExpiresAt: null },
          }),
        )
        .then(() => (count += 1))
        .catch((err: unknown) => {
          if (!(err instanceof ConflictException)) throw err;
        });
    }
    return count;
  }

  /** A13 after the deadline; reminder events 7 days and 1 day before (delivered by Phase 07). */
  async processCorrectionDeadlines(
    now = new Date(),
  ): Promise<{ abandoned: number; reminders: number }> {
    let reminders = 0;
    for (const [days, column] of [
      [7, 'reminder7At'],
      [1, 'reminder1At'],
    ] as const) {
      const due = await this.prisma.correctionRequest.findMany({
        where: {
          resolvedAt: null,
          [column]: null,
          dueAt: { lte: new Date(now.getTime() + days * 86_400_000), gt: now },
          application: { status: 'CORRECTION_REQUESTED' },
        },
        include: { application: true },
        take: 500,
      });
      for (const req of due) {
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.correctionRequest.updateMany({
            where: { id: req.id, [column]: null },
            data: { [column]: now },
          });
          if (claimed.count !== 1) return;
          await tx.outboxEvent.create({
            data: {
              type: 'CORRECTION_DEADLINE_REMINDER',
              aggregateType: 'Application',
              aggregateId: req.applicationId,
              payload: {
                applicationId: req.applicationId,
                applicantId: req.application.applicantId,
                referenceNo: req.application.referenceNo,
                dueAt: req.dueAt.toISOString(),
                daysLeft: days,
              },
            },
          });
          reminders += 1;
        });
      }
    }
    const overdue = await this.prisma.application.findMany({
      where: { status: 'CORRECTION_REQUESTED', correctionDueAt: { lt: now } },
      take: 200,
    });
    let abandoned = 0;
    for (const app of overdue) {
      await this.prisma
        .$transaction(async (tx) => {
          await this.state.transition(tx, {
            application: app,
            to: 'ABANDONED',
            actor: 'SYSTEM',
            note: 'Corrections were not made by the deadline',
            data: { decidedAt: now, slaPausedAt: null },
          });
          await tx.appointment.updateMany({
            where: { applicationId: app.id, status: 'SCHEDULED' },
            data: { status: 'CANCELLED' },
          });
        })
        .then(() => (abandoned += 1))
        .catch((err: unknown) => {
          if (!(err instanceof ConflictException)) throw err;
        });
    }
    return { abandoned, reminders };
  }

  /** FR-009: a deactivated officer's claims go back to the queue (A9 by the system). */
  async releaseClaimsOf(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const claimed = await tx.application.findMany({
      where: { assigneeId: userId, status: 'IN_REVIEW' },
    });
    for (const app of claimed) {
      await this.state.transition(tx, {
        application: app,
        to: 'QUEUED',
        actor: 'SYSTEM',
        note: 'Assignee deactivated',
        data: { assigneeId: null, claimExpiresAt: null },
      });
    }
    // Work waiting on the citizen, an appointment or a supervisor keeps its status but loses the assignee.
    const waiting = await tx.application.findMany({ where: { assigneeId: userId } });
    for (const app of waiting) {
      const changed = await tx.application.updateMany({
        where: { id: app.id, version: app.version },
        data: { assigneeId: null, claimExpiresAt: null, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw stale();
      await this.state.record(tx, app, app.status, null, 'SYSTEM', 'APPLICATION_UNASSIGNED', {
        note: 'Assignee deactivated',
        details: { from: userId },
      });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private allowedActions(user: AuthUser, app: Full): StaffAction[] {
    const can = (to: ApplicationStatus) => {
      try {
        this.state.assertAllowed({ application: app, to, actor: user });
        return true;
      } catch {
        return false;
      }
    };
    const out: StaffAction[] = [];
    const supervisor = user.role === 'SUPERVISOR';
    if (app.status === 'QUEUED' && can('IN_REVIEW')) out.push('CLAIM');
    if (supervisor && OPEN_FOR_STAFF.includes(app.status)) out.push('ASSIGN');
    if (app.status === 'IN_REVIEW' && can('QUEUED')) out.push('RELEASE');
    if (app.status === 'IN_REVIEW' && app.assigneeId === user.id) {
      out.push('REQUEST_CORRECTION', 'REJECT');
      if (
        app.service.inPersonStep !== 'NONE' &&
        !app.appointments.some((a) => a.status === 'ATTENDED')
      )
        out.push('SCHEDULE_APPOINTMENT');
      out.push('APPROVE');
      if (app.service.approvalMode === 'SUPERVISOR_ON_RECORD_FOUND') out.push('REFER');
    }
    if (app.status === 'AWAITING_APPOINTMENT' && can('IN_REVIEW')) out.push('RECORD_APPOINTMENT');
    if (app.status === 'AWAITING_SUPERVISOR' && supervisor && !this.isForwarder(user, app)) {
      out.push(
        app.reviewOutcome === 'RECORD_FOUND' ? 'CONFIRM_REFERRAL' : 'SECOND_APPROVE',
        'RETURN',
        'REJECT',
      );
    }
    if (app.chargebackFlag && supervisor) out.push('RESOLVE_CHARGEBACK');
    return out;
  }

  private assertCanApprove(app: Full, from: ApplicationStatus[] = ['IN_REVIEW']): void {
    if (!from.includes(app.status)) throw this.invalid(app.status);
    const blockers = approvalBlockers(app);
    if (blockers.length > 0)
      throw new ConflictException({
        code: 'APPROVAL_BLOCKED',
        message: blockers.join(' '),
        details: blockers,
      });
  }

  private isForwarder(user: AuthUser, app: Full): boolean {
    const forward = [...app.decisions]
      .reverse()
      .find((d) => d.level === 'OFFICER' && d.decision === 'FORWARD');
    return forward?.decidedById === user.id;
  }

  private assertSecondPerson(user: AuthUser, app: Full): void {
    if (this.isForwarder(user, app)) {
      throw new ForbiddenException({
        code: 'SECOND_PERSON_REQUIRED',
        message: 'The second decision must be made by a different person.',
      });
    }
  }

  private async supervisorDecision(
    tx: Prisma.TransactionClient,
    applicationId: string,
    decision: 'APPROVE' | 'REFER' | 'RETURN',
    user: AuthUser,
    note?: string,
  ): Promise<void> {
    try {
      await tx.reviewDecision.create({
        data: {
          applicationId,
          level: 'SUPERVISOR',
          decision,
          decidedById: user.id,
          note: note ?? null,
        },
      });
    } catch (err) {
      // The database trigger enforces the second-person rule too.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError ||
        String(err).includes('different person')
      ) {
        throw new ForbiddenException({
          code: 'SECOND_PERSON_REQUIRED',
          message: 'The second decision must be made by a different person.',
        });
      }
      throw err;
    }
  }

  private invalid(status: ApplicationStatus) {
    return new ConflictException({
      code: 'INVALID_TRANSITION',
      message: `This action is not possible while the application is ${status}.`,
    });
  }

  private claimExpiry(tx: Prisma.TransactionClient): Promise<Date> {
    return claimExpiry(tx, this.settings);
  }

  private async loadIn(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    id: string,
    version: number,
  ): Promise<Application> {
    const app = await tx.application.findUnique({ where: { id } });
    if (!app) throw new NotFoundException();
    assertSameDepartment(user, app.departmentId);
    if (app.version !== version) throw stale();
    return app;
  }

  private async loadFullIn(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    id: string,
    version: number,
  ): Promise<Full> {
    const app = await tx.application.findUnique({ where: { id }, include: detailInclude });
    if (!app) throw new NotFoundException();
    assertSameDepartment(user, app.departmentId);
    if (app.version !== version) throw stale();
    return app;
  }
}

/** FR-075. */
export function approvalBlockers(
  app: Pick<
    Full,
    'feeAssessment' | 'payments' | 'chargebackFlag' | 'appointments' | 'corrections'
  > & { service: Pick<Service, 'inPersonStep'> },
): string[] {
  const out: string[] = [];
  if (!app.feeAssessment || confirmedTotal(app.payments) < app.feeAssessment.totalCents)
    out.push('The fee is not paid in full.');
  if (app.service.inPersonStep !== 'NONE' && !app.appointments.some((a) => a.status === 'ATTENDED'))
    out.push('The in-person appointment has not been attended.');
  if (app.corrections.some((c) => !c.resolvedAt)) out.push('A correction request is still open.');
  if (app.chargebackFlag) out.push('A card payment was reversed; a supervisor must resolve it.');
  return out;
}

function riskOf(
  a: Pick<Application, 'queuedAt' | 'slaDueAt' | 'slaPausedAt' | 'slaPausedTotalMs' | 'status'>,
  now: Date,
) {
  if (!OPEN_FOR_STAFF.includes(a.status)) return 'NONE' as const;
  return slaRisk({
    queuedAt: a.queuedAt,
    slaDueAt: a.slaDueAt,
    pausedAt: a.slaPausedAt,
    pausedTotalMs: Number(a.slaPausedTotalMs),
    now,
  });
}
