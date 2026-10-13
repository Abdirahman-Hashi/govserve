import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assessDuplicateFee,
  bytesToBase64Url,
  type CertificatePayload,
  type CertificateSummary,
  maskName,
  normaliseName,
  type PublicCertificate,
  type RevokeCertificateRequest,
} from '@govserve/shared';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { assertCitizenOwns, assertSameDepartment } from '../common/guards/scope';
import { type RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config.module';
import { CryptoService } from '../crypto/crypto.service';
import { readFormValues } from '../applications/form-data';
import { ApplicationStateService } from '../applications/application-state.service';
import {
  type Application,
  type Certificate,
  type Prisma,
  type Service,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { fiscalYear } from '../receipts/receipts.service';
import { certificateStatus } from './certificate-status';

export { certificateStatus };
import { SigningService } from '../receipts/signing.service';

type Actor = AuthUser | 'SYSTEM';
const auditActor = (a: Actor): AuditActor =>
  a === 'SYSTEM'
    ? { id: null, role: null, type: 'SYSTEM' }
    : { id: a.id, role: a.role, type: 'USER' };

/** VALID, or EXPIRED (derived), or REVOKED. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function toCertificateSummary(
  c: Certificate & { service: Pick<Service, 'name'> },
): CertificateSummary {
  return {
    id: c.id,
    certificateNo: c.certificateNo,
    serviceName: c.service.name,
    holderName: c.holderName,
    issuedAt: c.issuedAt.toISOString(),
    expiresAt: c.expiresAt?.toISOString() ?? null,
    status: certificateStatus(c),
    revokeReason: c.revokeReason,
    isDuplicate: c.duplicateOfId !== null,
  };
}

/**
 * Certificates (FR-090–FR-095, STATE_MACHINES §4). Issued inside the approving transaction,
 * signed with Ed25519 (ADR-0006); the PDF is rendered on demand from the stored payload.
 */
@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signing: SigningService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly appState: ApplicationStateService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** C1 (+ C3): issues the certificate for an approved STANDARD application. */
  async issue(
    tx: Prisma.TransactionClient,
    app: Application & { service: Service },
    actor: Actor,
    now = new Date(),
  ): Promise<Certificate> {
    const data = await tx.applicationData.findUnique({ where: { applicationId: app.id } });
    const holderName = data?.subjectFullName;
    if (!holderName || !app.subjectKey)
      throw new Error(`Application ${app.id} has no subject to certify`);
    // C3: the previous VALID certificate for this subject is superseded (revoked first: one VALID per subject).
    const previous = await tx.certificate.findFirst({
      where: {
        serviceId: app.serviceId,
        subjectKey: app.subjectKey,
        status: 'VALID',
        duplicateOfId: null,
      },
    });
    if (previous) {
      const superseded = await tx.certificate.updateMany({
        where: { id: previous.id, status: 'VALID', version: previous.version },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokeReason: 'SUPERSEDED',
          revokeNote: 'Replaced by a newer certificate',
          version: { increment: 1 },
        },
      });
      if (superseded.count !== 1)
        throw new ConflictException({
          code: 'CONCURRENT_UPDATE',
          message: 'The previous certificate was just changed. Try again.',
        });
      await this.cascadeToDuplicates(tx, previous, 'SUPERSEDED', actor, app.departmentId, now);
    }
    const cert = await this.create(tx, {
      app,
      holderName,
      expiresAt: app.service.validityMonths ? addMonths(now, app.service.validityMonths) : null,
      duplicateOfId: null,
      now,
    });
    if (previous) {
      await tx.certificate.update({
        where: { id: previous.id },
        data: { supersededById: cert.id },
      });
      await this.record(tx, actor, 'CERTIFICATE_SUPERSEDED', previous, app.departmentId, {
        supersededBy: cert.certificateNo,
      });
    }
    await this.record(tx, actor, 'CERTIFICATE_ISSUED', cert, app.departmentId, {
      applicationId: app.id,
    });
    return cert;
  }

  /** A6: issues the copies of a DUPLICATE application (same holder and expiry, new number). */
  async issueDuplicate(
    tx: Prisma.TransactionClient,
    app: Application & { service: Service },
    now = new Date(),
  ): Promise<Certificate | null> {
    const source = app.sourceCertificateId
      ? await tx.certificate.findUnique({ where: { id: app.sourceCertificateId } })
      : null;
    // The source must still be valid; otherwise the payment stays for an officer to refund.
    if (!source || certificateStatus(source, now) !== 'VALID') return null;
    const cert = await this.create(tx, {
      app,
      holderName: source.holderName,
      expiresAt: source.expiresAt,
      duplicateOfId: source.id,
      now,
      subjectKey: source.subjectKey,
    });
    await this.record(tx, 'SYSTEM', 'CERTIFICATE_ISSUED', cert, app.departmentId, {
      applicationId: app.id,
      duplicateOf: source.certificateNo,
      copies: app.extraCopies,
    });
    return cert;
  }

  /** C2: supervisor revokes a certificate (and its copies). */
  async revoke(
    user: AuthUser,
    certificateId: string,
    body: RevokeCertificateRequest,
    ctx: RequestContext,
  ): Promise<CertificateSummary> {
    await this.prisma.$transaction(async (tx) => {
      const cert = await tx.certificate.findUnique({
        where: { id: certificateId },
        include: { application: true },
      });
      if (!cert) throw new NotFoundException();
      assertSameDepartment(user, cert.application.departmentId);
      if (user.role !== 'SUPERVISOR')
        throw new ForbiddenException({
          code: 'SUPERVISOR_ONLY',
          message: 'Only a supervisor can revoke certificates.',
        });
      await this.revokeIn(
        tx,
        cert,
        body.reason,
        body.note,
        user,
        cert.application.departmentId,
        ctx,
      );
    });
    return this.summary(certificateId);
  }

  async revokeIn(
    tx: Prisma.TransactionClient,
    cert: Certificate,
    reason: RevokeCertificateRequest['reason'],
    note: string,
    actor: Actor,
    departmentId: string,
    ctx?: RequestContext,
  ): Promise<void> {
    const now = new Date();
    const changed = await tx.certificate.updateMany({
      where: { id: cert.id, status: 'VALID', version: cert.version },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        revokedById: actor === 'SYSTEM' ? null : actor.id,
        revokeReason: reason,
        revokeNote: note,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1)
      throw new ConflictException({
        code: 'NOT_REVOCABLE',
        message: 'This certificate is already revoked or was just changed.',
      });
    await this.record(tx, actor, 'CERTIFICATE_REVOKED', cert, departmentId, { reason }, ctx);
    await this.cascadeToDuplicates(tx, cert, reason, actor, departmentId, now, ctx);
  }

  /** FR-094: order copies of a VALID certificate; creates a DUPLICATE application awaiting payment. */
  async orderDuplicate(
    user: AuthUser,
    certificateId: string,
    copies: number,
    ctx: RequestContext,
  ): Promise<{ applicationId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const cert = await tx.certificate.findUnique({
        where: { id: certificateId },
        include: { application: true },
      });
      if (!cert) throw new NotFoundException();
      assertCitizenOwns(user, cert.holderUserId);
      if (certificateStatus(cert) !== 'VALID') {
        throw new ConflictException({
          code: 'NOT_VALID',
          message: 'Copies can only be ordered of a valid certificate.',
        });
      }
      const service = await tx.service.findUniqueOrThrow({
        where: { id: cert.serviceId },
        include: { versions: { where: { status: 'PUBLISHED' } } },
      });
      const version = service.versions[0];
      if (!version)
        throw new ConflictException({
          code: 'SERVICE_UNAVAILABLE',
          message: 'This service is not available.',
        });
      const fee = assessDuplicateFee(
        { baseCents: version.feeBaseCents, perCopyCents: version.feePerCopyCents },
        copies,
      );
      const [{ nextval }] = await tx.$queryRaw<
        [{ nextval: bigint }]
      >`SELECT nextval('application_ref_seq')`;
      const now = new Date();
      const app = await tx.application.create({
        data: {
          kind: 'DUPLICATE',
          applicantId: user.id,
          serviceId: service.id,
          serviceVersionId: version.id,
          departmentId: service.departmentId,
          sourceCertificateId: cert.id,
          extraCopies: copies,
          referenceNo: `GS-${now.getUTCFullYear()}-${nextval.toString().padStart(6, '0')}`,
          submittedAt: now,
          data: { create: {} },
          feeAssessment: {
            create: {
              lines: fee.lines.map((l) => ({
                ...l,
                unitCents: l.unitCents.toString(),
                amountCents: l.amountCents.toString(),
              })),
              totalCents: fee.totalCents,
              ruleSnapshot: {
                versionNo: version.versionNo,
                perCopy: version.feePerCopyCents.toString(),
                feeIsTest: version.feeIsTest,
                duplicateOf: cert.certificateNo,
              },
            },
          },
        },
      });
      await this.appState.record(tx, app, null, 'DRAFT', user, 'APPLICATION_CREATED', {
        ctx,
        details: { kind: 'DUPLICATE', copies },
      });
      await this.appState.transition(tx, {
        application: app,
        to: 'AWAITING_PAYMENT',
        actor: user,
        ctx,
        details: { totalCents: fee.totalCents.toString() },
      });
      return { applicationId: app.id };
    });
  }

  async listMine(user: AuthUser): Promise<CertificateSummary[]> {
    const rows = await this.prisma.certificate.findMany({
      where: { holderUserId: user.id },
      include: { service: true },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map(toCertificateSummary);
  }

  async summary(id: string): Promise<CertificateSummary> {
    return toCertificateSummary(
      await this.prisma.certificate.findUniqueOrThrow({
        where: { id },
        include: { service: true },
      }),
    );
  }

  /** FR-092: public status; no ID numbers, addresses, parents or record content. */
  async publicCertificate(certificateNo: string): Promise<PublicCertificate> {
    const cert = await this.prisma.certificate.findUnique({
      where: { certificateNo },
      include: { service: true },
    });
    if (!cert) throw new NotFoundException();
    return {
      certificateNo,
      serviceName: cert.service.name,
      status: certificateStatus(cert),
      issuedAt: cert.issuedAt.toISOString(),
      expiresAt: cert.expiresAt?.toISOString() ?? null,
      revokedAt: cert.revokedAt?.toISOString() ?? null,
      holderNameMasked: cert.holderNameMasked,
      payload: cert.payloadJson as CertificatePayload,
    };
  }

  /** Answers only whether the name matches; the attempt is audited without storing the name. */
  async nameCheck(
    certificateNo: string,
    name: string,
    ctx: RequestContext,
  ): Promise<{ match: boolean }> {
    const cert = await this.prisma.certificate.findUnique({
      where: { certificateNo },
      include: { application: { select: { departmentId: true } } },
    });
    if (!cert) throw new NotFoundException();
    const match = normaliseName(name) === normaliseName(cert.holderName);
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, {
        actor: { id: null, role: null, type: 'PUBLIC' },
        action: 'CERTIFICATE_NAME_CHECKED',
        entityType: 'Certificate',
        entityId: cert.id,
        departmentId: cert.application.departmentId,
        after: { match },
        ctx,
      }),
    );
    return { match };
  }

  verifyUrl(cert: Pick<Certificate, 'certificateNo' | 'signature'>): string {
    return `${this.config.WEB_ORIGIN}/verify/c/${encodeURIComponent(cert.certificateNo)}#sig=${bytesToBase64Url(cert.signature)}`;
  }

  /** C4: PDF for the owner citizen or staff of the department (downloads audited). */
  async pdf(
    user: AuthUser,
    certificateId: string,
    ctx: RequestContext,
  ): Promise<{ fileName: string; pdf: Buffer }> {
    const cert = await this.prisma.certificate.findUnique({
      where: { id: certificateId },
      include: { service: true, application: { include: { data: true } } },
    });
    if (!cert) throw new NotFoundException();
    if (user.role === 'CITIZEN') assertCitizenOwns(user, cert.holderUserId);
    else assertSameDepartment(user, cert.application.departmentId);
    await this.prisma.$transaction((tx) =>
      this.record(tx, user, 'CERTIFICATE_DOWNLOADED', cert, cert.application.departmentId, {}, ctx),
    );
    // Duplicates carry no answers of their own: use the original application's.
    const sourceApp = cert.duplicateOfId
      ? (
          await this.prisma.certificate.findUniqueOrThrow({
            where: { id: cert.duplicateOfId },
            include: { application: { include: { data: true } } },
          })
        ).application
      : cert.application;
    const values = readFormValues(this.crypto, sourceApp.data);
    return {
      fileName: `${cert.certificateNo}.pdf`,
      pdf: await this.render(cert, cert.service, values),
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async create(
    tx: Prisma.TransactionClient,
    input: {
      app: Application & { service: Service };
      holderName: string;
      expiresAt: Date | null;
      duplicateOfId: string | null;
      now: Date;
      subjectKey?: string;
    },
  ): Promise<Certificate> {
    const { app, now } = input;
    const year = fiscalYear(now);
    const [row] = await tx.$queryRaw<[{ value: bigint }]>`
      INSERT INTO "counter" ("name", "nextValue") VALUES (${`cert:${app.service.certificatePrefix}:${year}`}, 2)
      ON CONFLICT ("name") DO UPDATE SET "nextValue" = "counter"."nextValue" + 1
      RETURNING "nextValue" - 1 AS value`;
    const certificateNo = `${app.service.certificatePrefix}-${year}-${row.value.toString().padStart(6, '0')}`;
    const masked = maskName(input.holderName);
    const payload: CertificatePayload = {
      t: 'CERT',
      no: certificateNo,
      svc: app.service.name,
      iss: now.toISOString(),
      ...(input.expiresAt && { exp: input.expiresAt.toISOString() }),
      h: masked,
      kid: this.signing.activeKeyId(),
    };
    return tx.certificate.create({
      data: {
        certificateNo,
        applicationId: app.id,
        serviceId: app.serviceId,
        holderUserId: app.applicantId,
        subjectKey: input.subjectKey ?? app.subjectKey!,
        holderName: input.holderName,
        holderNameMasked: masked,
        issuedAt: now,
        expiresAt: input.expiresAt,
        duplicateOfId: input.duplicateOfId,
        payloadJson: payload,
        signature: new Uint8Array(this.signing.sign(payload)),
        keyId: payload.kid,
      },
    });
  }

  /** Copies follow their original: each is revoked under its own version check and audited. */
  private async cascadeToDuplicates(
    tx: Prisma.TransactionClient,
    source: Certificate,
    reason: Certificate['revokeReason'] & string,
    actor: Actor,
    departmentId: string,
    now: Date,
    ctx?: RequestContext,
  ): Promise<void> {
    const copies = await tx.certificate.findMany({
      where: { duplicateOfId: source.id, status: 'VALID' },
    });
    for (const copy of copies) {
      const changed = await tx.certificate.updateMany({
        where: { id: copy.id, status: 'VALID', version: copy.version },
        data: {
          status: 'REVOKED',
          revokedAt: now,
          revokedById: actor === 'SYSTEM' ? null : actor.id,
          revokeReason: reason,
          revokeNote: 'The original certificate was revoked',
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ConflictException({
          code: 'CONCURRENT_UPDATE',
          message: 'A copy of this certificate was just changed. Try again.',
        });
      await this.record(
        tx,
        actor,
        'CERTIFICATE_REVOKED',
        copy,
        departmentId,
        { reason, cascadedFrom: source.certificateNo },
        ctx,
      );
    }
  }

  private async record(
    tx: Prisma.TransactionClient,
    actor: Actor,
    action: string,
    cert: Certificate,
    departmentId: string,
    details: Record<string, Prisma.InputJsonValue>,
    ctx?: RequestContext,
  ): Promise<void> {
    const after = { certificateNo: cert.certificateNo, ...details };
    await this.audit.record(tx, {
      actor: auditActor(actor),
      action,
      entityType: 'Certificate',
      entityId: cert.id,
      departmentId,
      after,
      ...(ctx && { ctx }),
    });
    await tx.outboxEvent.create({
      data: {
        type: action,
        aggregateType: 'Certificate',
        aggregateId: cert.id,
        payload: {
          certificateId: cert.id,
          holderUserId: cert.holderUserId,
          departmentId,
          ...after,
        },
      },
    });
  }

  private async render(
    cert: Certificate,
    service: Service,
    values: Record<string, string | number | boolean>,
  ): Promise<Buffer> {
    const payload = cert.payloadJson as CertificatePayload;
    const qr = await QRCode.toBuffer(this.verifyUrl(cert), {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    });
    const doc = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: { Title: `${service.name} ${cert.certificateNo}`, Author: 'GovServe' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );
    const date = (iso: string) =>
      new Date(iso).toLocaleDateString('en-GB', {
        timeZone: 'Africa/Mogadishu',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    const v = (k: string) => (values[k] === undefined ? '—' : String(values[k]));

    doc
      .fontSize(18)
      .text('Federal Republic of Somalia — Banadir Regional Administration', { align: 'center' })
      .moveDown(0.3);
    doc.fontSize(14).text(service.name.toUpperCase(), { align: 'center' }).moveDown(0.2);
    doc
      .fontSize(10)
      .text(
        `Certificate number ${cert.certificateNo}${cert.duplicateOfId ? ' (certified copy)' : ''}`,
        { align: 'center' },
      )
      .moveDown(1.5);
    doc.fontSize(12);
    if (service.code === 'PROOF_OF_ADDRESS') {
      doc.text(
        `This certifies that ${cert.holderName} resides at ${v('streetOrLandmark')}${values['houseNumber'] ? `, house ${v('houseNumber')}` : ''}, ${v('neighbourhood')}, ${v('district')} district, Banadir.`,
      );
    } else if (service.code === 'POLICE_CLEARANCE') {
      doc.text(
        `This certifies that a search of the records of the Criminal Investigation Department found no criminal record for ${cert.holderName}, born ${v('dateOfBirth')} in ${v('placeOfBirth')}.`,
      );
    } else if (service.code === 'BIRTH_CERTIFICATE') {
      doc
        .text(`Name: ${cert.holderName}`)
        .text(`Sex: ${v('sex') === 'FEMALE' ? 'Female' : v('sex') === 'MALE' ? 'Male' : '—'}`)
        .text(`Date of birth: ${v('dateOfBirth')}`);
      doc
        .text(
          `Place of birth: ${v('birthDistrict')} district${values['hospitalName'] ? `, ${v('hospitalName')}` : ''}`,
        )
        .text(`Father: ${v('fatherFullName')}`)
        .text(`Mother: ${v('motherFullName')}`);
    } else {
      doc.text(`Issued to ${cert.holderName}.`);
    }
    doc
      .moveDown(1.5)
      .fontSize(11)
      .text(`Issued on ${date(payload.iss)}.`);
    doc.text(
      payload.exp ? `Valid until ${date(payload.exp)}.` : 'This certificate does not expire.',
    );
    doc.moveDown(2);
    doc.image(qr, { fit: [140, 140], align: 'center' });
    doc
      .moveDown(0.5)
      .fontSize(9)
      .text('Scan the QR code to check that this certificate is genuine and still valid.', {
        align: 'center',
      });
    doc
      .fontSize(8)
      .fillColor('#555')
      .text(`Digitally signed (Ed25519, key ${cert.keyId}).`, { align: 'center' });
    doc.end();
    return done;
  }
}
