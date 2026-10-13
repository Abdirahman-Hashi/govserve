import { createHash, randomUUID } from 'node:crypto';
import { type Readable } from 'node:stream';
import { InjectQueue } from '@nestjs/bullmq';
import {
  GoneException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type DocumentDto,
  type DownloadTicket,
  type RequestEvidenceUploadRequest,
  type RequestUploadRequest,
  type RequiredDocument,
  type UploadTicket,
} from '@govserve/shared';
import { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { type AuthUser } from '../auth/auth.types';
import { assertCitizenOwns, assertSameDepartment } from '../common/guards/scope';
import { sniffMime, SNIFF_BYTES } from './file-type';
import { VIRUS_SCAN_PORT, type VirusScanPort } from './virus-scan.port';
import { type Document, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PORT, type StoragePort } from '../storage/storage.port';
import { editability } from '../applications/applications.service';
import { PAYMENT_EVIDENCE, toDocumentDto } from './documents.mapper';

export const DOCUMENTS_QUEUE = 'documents';
export const SCAN_JOB = 'scan';

const UPLOAD_URL_TTL_SECONDS = 300;
const DOWNLOAD_URL_TTL_SECONDS = 60;
const MAX_PENDING_UPLOADS = 20;

const notEditable = () =>
  new ConflictException({
    code: 'NOT_EDITABLE',
    message: 'Documents for this application cannot be changed now.',
  });

/**
 * Private document uploads (FR-035, ADR-0004): pre-signed PUT straight to storage, then the
 * server verifies size, real file type and SHA-256 before the file is quarantined and scanned.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(VIRUS_SCAN_PORT) private readonly scanner: VirusScanPort,
    @InjectQueue(DOCUMENTS_QUEUE) private readonly queue: Queue,
  ) {}

  async requestUpload(
    user: AuthUser,
    applicationId: string,
    body: RequestUploadRequest,
  ): Promise<UploadTicket> {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        serviceVersion: true,
        corrections: { where: { resolvedAt: null }, include: { items: true } },
      },
    });
    if (!app) throw new NotFoundException();
    assertCitizenOwns(user, app.applicantId);
    const edit = editability(app);
    if (edit.docTypes !== null && !edit.docTypes.includes(body.docType)) throw notEditable();

    const spec = (app.serviceVersion.requiredDocuments as unknown as RequiredDocument[]).find(
      (d) => d.type === body.docType,
    );
    const problems: { path: string; message: string }[] = [];
    if (!spec)
      problems.push({
        path: 'docType',
        message: 'This document is not requested for this service',
      });
    else {
      if (!spec.mime.includes(body.mime))
        problems.push({ path: 'mime', message: `Upload ${spec.mime.join(', ')} only` });
      if (body.sizeBytes > spec.maxBytes) {
        problems.push({
          path: 'sizeBytes',
          message: `Files can be at most ${Math.floor(spec.maxBytes / 1048576)} MB`,
        });
      }
    }
    if (problems.length > 0) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_FAILED',
        message: 'This file cannot be uploaded',
        details: problems,
      });
    }
    return this.createUpload(user, app.id, app.departmentId, body);
  }

  /**
   * Payment evidence (screenshot or deposit slip) while the application awaits payment. Same
   * verification and scanning as any upload; it is linked to the payment when that is reported.
   */
  async requestEvidenceUpload(
    user: AuthUser,
    applicationId: string,
    body: RequestEvidenceUploadRequest,
  ): Promise<UploadTicket> {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException();
    assertCitizenOwns(user, app.applicantId);
    if (app.status !== 'AWAITING_PAYMENT') {
      throw new ConflictException({
        code: 'NOT_AWAITING_PAYMENT',
        message: 'This application is not awaiting payment.',
      });
    }
    return this.createUpload(user, app.id, app.departmentId, {
      ...body,
      docType: PAYMENT_EVIDENCE,
    });
  }

  /** Staff of the application's department open a document; every view is audited. */
  async staffDownload(user: AuthUser, documentId: string): Promise<DownloadTicket> {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc?.applicationId) throw new NotFoundException();
    const departmentId = await this.departmentOf(this.prisma, doc);
    assertSameDepartment(user, departmentId);
    if (doc.purgedAt) {
      throw new GoneException({
        code: 'DOCUMENT_PURGED',
        message: 'This file was deleted under the retention policy.',
      });
    }
    // Staff only ever open files that passed the virus scan.
    if (doc.status !== 'CLEAN') {
      throw new ConflictException({
        code: 'NOT_AVAILABLE',
        message: 'This file is not available yet.',
      });
    }
    await this.prisma.$transaction((tx) =>
      this.record(tx, user, 'DOCUMENT_VIEWED', doc, departmentId, { after: {} }),
    );
    const url = await this.storage.presignGet({
      key: doc.storageKey,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      downloadName: doc.originalName,
    });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  private async createUpload(
    user: AuthUser,
    applicationId: string,
    departmentId: string,
    body: RequestUploadRequest,
  ): Promise<UploadTicket> {
    const pending = await this.prisma.document.count({
      where: { applicationId, status: 'PENDING_UPLOAD' },
    });
    if (pending >= MAX_PENDING_UPLOADS) {
      throw new ConflictException({
        code: 'TOO_MANY_PENDING_UPLOADS',
        message: 'Finish or retry your current uploads first.',
      });
    }
    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          applicationId,
          ownerId: user.id,
          docType: body.docType,
          // Opaque key: never derived from the file name.
          storageKey: `docs/${randomUUID()}`,
          originalName: body.fileName,
          mime: body.mime,
          sizeBytes: body.sizeBytes,
          sha256: body.sha256,
        },
      });
      await this.record(tx, user, 'DOCUMENT_UPLOAD_REQUESTED', created, departmentId, {
        after: { status: 'PENDING_UPLOAD' },
      });
      return created;
    });
    const { url, headers } = await this.storage.presignPut({
      key: doc.storageKey,
      contentType: doc.mime,
      contentLength: doc.sizeBytes,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
    return {
      document: toDocumentDto(doc),
      uploadUrl: url,
      headers,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Verifies the uploaded object, then quarantines it and queues the virus scan. */
  async complete(user: AuthUser, documentId: string): Promise<DocumentDto> {
    const doc = await this.ownedDocument(user, documentId);
    if (doc.status !== 'PENDING_UPLOAD') return toDocumentDto(doc);

    const head = await this.storage.head(doc.storageKey);
    if (!head)
      throw new ConflictException({
        code: 'UPLOAD_MISSING',
        message: 'The file has not finished uploading. Try again.',
      });

    const reason = await this.verify(doc, head.size);
    if (reason) {
      await this.storage.delete(doc.storageKey).catch(() => undefined);
      const rejected = await this.prisma.$transaction(async (tx) => {
        const row = await tx.document.update({
          where: { id: doc.id },
          data: { status: 'REJECTED', statusReason: reason },
        });
        await this.record(tx, user, 'DOCUMENT_REJECTED', row, await this.departmentOf(tx, row), {
          before: { status: 'PENDING_UPLOAD' },
          after: { status: 'REJECTED', reason },
        });
        return row;
      });
      throw new UnprocessableEntityException({
        code: 'UPLOAD_REJECTED',
        message: reason,
        details: { document: toDocumentDto(rejected) },
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.document.updateMany({
        where: { id: doc.id, status: 'PENDING_UPLOAD' },
        data: { status: 'QUARANTINED', uploadedAt: new Date() },
      });
      if (claimed.count !== 1) return tx.document.findUniqueOrThrow({ where: { id: doc.id } });
      // The new file replaces the previous upload of the same type (history is kept).
      const replaced = await tx.document.findMany({
        where: {
          applicationId: doc.applicationId,
          docType: doc.docType,
          supersededById: null,
          id: { not: doc.id },
          status: { notIn: ['PENDING_UPLOAD'] },
        },
        select: { id: true },
      });
      await tx.document.updateMany({
        where: { id: { in: replaced.map((r) => r.id) } },
        data: { supersededById: doc.id },
      });
      const row = await tx.document.findUniqueOrThrow({ where: { id: doc.id } });
      await this.record(tx, user, 'DOCUMENT_UPLOADED', row, await this.departmentOf(tx, row), {
        before: { status: 'PENDING_UPLOAD' },
        after: { status: 'QUARANTINED', replaces: replaced.map((r) => r.id) },
      });
      return row;
    });
    await this.queue.add(
      SCAN_JOB,
      { documentId: doc.id },
      { jobId: `scan-${doc.id}`, attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
    );
    return toDocumentDto(updated);
  }

  /** Runs the virus scan (BullMQ worker). Infected files are deleted from storage. */
  async scan(documentId: string): Promise<void> {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || doc.status !== 'QUARANTINED') return;
    const result = await this.scanner.scan(await this.storage.read(doc.storageKey));
    if (result.clean) {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.document.updateMany({
          where: { id: doc.id, status: 'QUARANTINED' },
          data: { status: 'CLEAN', scannedAt: new Date() },
        });
        if (changed.count !== 1) return;
        await this.record(tx, 'SYSTEM', 'DOCUMENT_CLEAN', doc, await this.departmentOf(tx, doc), {
          before: { status: 'QUARANTINED' },
          after: { status: 'CLEAN' },
        });
      });
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: doc.id },
        data: {
          status: 'INFECTED',
          statusReason: 'The file failed the virus check',
          scannedAt: new Date(),
        },
      });
      await this.record(tx, 'SYSTEM', 'DOCUMENT_INFECTED', doc, await this.departmentOf(tx, doc), {
        before: { status: 'QUARANTINED' },
        after: { status: 'INFECTED', signature: result.signature },
      });
    });
    await this.storage.delete(doc.storageKey).catch(() => undefined);
    this.logger.warn(
      { documentId: doc.id, signature: result.signature },
      'Infected upload removed',
    );
  }

  async download(user: AuthUser, documentId: string): Promise<DownloadTicket> {
    const doc = await this.ownedDocument(user, documentId);
    if (doc.purgedAt) {
      throw new GoneException({
        code: 'DOCUMENT_PURGED',
        message: 'This file was deleted under the retention policy.',
      });
    }
    if (doc.status !== 'CLEAN' && doc.status !== 'QUARANTINED') {
      throw new ConflictException({
        code: 'NOT_AVAILABLE',
        message: 'This file is not available for download.',
      });
    }
    const url = await this.storage.presignGet({
      key: doc.storageKey,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      downloadName: doc.originalName,
    });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
  }

  async remove(user: AuthUser, documentId: string): Promise<void> {
    const doc = await this.ownedDocument(user, documentId);
    const app = await this.prisma.application.findUniqueOrThrow({
      where: { id: doc.applicationId! },
      include: { corrections: { where: { resolvedAt: null }, include: { items: true } } },
    });
    const edit = editability(app);
    if (edit.docTypes !== null && !edit.docTypes.includes(doc.docType)) throw notEditable();
    await this.prisma.$transaction(async (tx) => {
      // Bring back the upload this one replaced, if any.
      const restored = await tx.document.findMany({
        where: { supersededById: doc.id },
        select: { id: true },
      });
      await tx.document.updateMany({
        where: { supersededById: doc.id },
        data: { supersededById: null },
      });
      await tx.document.delete({ where: { id: doc.id } });
      await this.record(tx, user, 'DOCUMENT_REMOVED', doc, app.departmentId, {
        before: { status: doc.status },
        after: { restored: restored.map((r) => r.id) },
      });
    });
    await this.storage.delete(doc.storageKey).catch(() => undefined);
  }

  /**
   * Audits a document change in the caller's transaction. The file name is never recorded
   * (it can contain personal details); type, size and IDs are enough to trace what happened.
   */
  private async record(
    tx: Prisma.TransactionClient,
    actor: AuthUser | 'SYSTEM',
    action: string,
    doc: Document,
    departmentId: string | null,
    change: {
      before?: Prisma.InputJsonValue;
      after?: Record<string, Prisma.InputJsonValue | null>;
    },
  ): Promise<void> {
    await this.audit.record(tx, {
      actor:
        actor === 'SYSTEM'
          ? { id: null, role: null, type: 'SYSTEM' }
          : { id: actor.id, role: actor.role, type: 'USER' },
      action,
      entityType: 'Document',
      entityId: doc.id,
      departmentId,
      ...(change.before !== undefined && { before: change.before }),
      after: {
        applicationId: doc.applicationId,
        docType: doc.docType,
        mime: doc.mime,
        sizeBytes: doc.sizeBytes,
        ...change.after,
      },
    });
  }

  private async departmentOf(
    tx: Prisma.TransactionClient,
    doc: Pick<Document, 'applicationId'>,
  ): Promise<string | null> {
    if (!doc.applicationId) return null;
    const app = await tx.application.findUnique({
      where: { id: doc.applicationId },
      select: { departmentId: true },
    });
    return app?.departmentId ?? null;
  }

  private async ownedDocument(user: AuthUser, documentId: string): Promise<Document> {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || !doc.applicationId) throw new NotFoundException();
    // Staff access to documents arrives with the review workflow (Phase 06); citizens see only theirs.
    if (doc.ownerId !== user.id) throw new NotFoundException();
    return doc;
  }

  /** Returns a reason when the stored object is not the file that was declared. */
  private async verify(doc: Document, storedSize: number): Promise<string | null> {
    if (storedSize !== doc.sizeBytes) return 'The uploaded file size does not match';
    const head = await readAll(await this.storage.read(doc.storageKey, { length: SNIFF_BYTES }));
    const sniffed = sniffMime(head);
    if (!sniffed) return 'This file type is not accepted. Upload a PDF, JPG or PNG.';
    if (sniffed !== doc.mime) return 'The file content does not match its type';
    const digest = createHash('sha256');
    for await (const chunk of await this.storage.read(doc.storageKey))
      digest.update(chunk as Buffer);
    if (digest.digest('hex') !== doc.sha256)
      return 'The file was corrupted during upload. Try again.';
    return null;
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}
