import { type DocumentDto } from '@govserve/shared';
import { type Document, type DocumentStatus } from '../generated/prisma/client';

/** Document type for payment evidence (screenshots, deposit slips); not a required document. */
export const PAYMENT_EVIDENCE = 'PAYMENT_EVIDENCE';

/** Uploads that count towards completeness (pending and rejected uploads do not). */
export const USABLE_STATUSES: DocumentStatus[] = ['QUARANTINED', 'CLEAN', 'INFECTED'];

export function toDocumentDto(d: Document): DocumentDto {
  return {
    id: d.id,
    docType: d.docType,
    originalName: d.originalName,
    mime: d.mime,
    sizeBytes: d.sizeBytes,
    status: d.status,
    statusReason: d.statusReason,
    createdAt: d.createdAt.toISOString(),
  };
}
