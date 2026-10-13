-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'QUEUED', 'IN_REVIEW', 'CORRECTION_REQUESTED', 'AWAITING_APPOINTMENT', 'AWAITING_SUPERVISOR', 'ISSUED', 'REJECTED', 'REFERRED', 'WITHDRAWN', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ApplicationKind" AS ENUM ('STANDARD', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('SELF', 'CHILD');

-- CreateEnum
CREATE TYPE "Relationship" AS ENUM ('SELF', 'MOTHER', 'FATHER', 'GUARDIAN');

-- CreateEnum
CREATE TYPE "ReviewOutcome" AS ENUM ('NO_RECORD', 'RECORD_FOUND');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_UPLOAD', 'QUARANTINED', 'CLEAN', 'INFECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CorrectionItemKind" AS ENUM ('FIELD', 'DOCUMENT');

-- CreateTable
CREATE TABLE "application" (
    "id" UUID NOT NULL,
    "referenceNo" TEXT,
    "kind" "ApplicationKind" NOT NULL DEFAULT 'STANDARD',
    "applicantId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "serviceVersionId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "subjectType" "SubjectType",
    "subjectKey" TEXT,
    "relationship" "Relationship",
    "extraCopies" INTEGER NOT NULL DEFAULT 0,
    "sourceCertificateId" UUID,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "assigneeId" UUID,
    "claimExpiresAt" TIMESTAMPTZ(3),
    "correctionRound" INTEGER NOT NULL DEFAULT 0,
    "correctionDueAt" TIMESTAMPTZ(3),
    "slaDueAt" TIMESTAMPTZ(3),
    "slaPausedAt" TIMESTAMPTZ(3),
    "slaPausedTotalMs" BIGINT NOT NULL DEFAULT 0,
    "reviewOutcome" "ReviewOutcome",
    "chargebackFlag" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMPTZ(3),
    "queuedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_data" (
    "applicationId" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "piiEnc" BYTEA,
    "subjectFullName" TEXT,
    "subjectNationalIdBidx" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_data_pkey" PRIMARY KEY ("applicationId")
);

-- CreateTable
CREATE TABLE "application_status_history" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "fromStatus" "ApplicationStatus",
    "toStatus" "ApplicationStatus" NOT NULL,
    "actorId" UUID,
    "actorType" "ActorType" NOT NULL,
    "note" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "applicationId" UUID,
    "paymentId" UUID,
    "ownerId" UUID NOT NULL,
    "docType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "statusReason" TEXT,
    "supersededById" UUID,
    "uploadedAt" TIMESTAMPTZ(3),
    "scannedAt" TIMESTAMPTZ(3),
    "purgedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_request" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "requestedById" UUID NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_item" (
    "id" UUID NOT NULL,
    "correctionRequestId" UUID NOT NULL,
    "kind" "CorrectionItemKind" NOT NULL,
    "target" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "correction_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_assessment" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "lines" JSONB NOT NULL,
    "totalCents" BIGINT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "assessedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_referenceNo_key" ON "application"("referenceNo");

-- CreateIndex
CREATE INDEX "application_departmentId_status_slaDueAt_idx" ON "application"("departmentId", "status", "slaDueAt");

-- CreateIndex
CREATE INDEX "application_assigneeId_status_idx" ON "application"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "application_applicantId_createdAt_idx" ON "application"("applicantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "application_status_updatedAt_idx" ON "application"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "application_data_subjectNationalIdBidx_idx" ON "application_data"("subjectNationalIdBidx");

-- CreateIndex
CREATE INDEX "application_status_history_applicationId_at_idx" ON "application_status_history"("applicationId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "document_storageKey_key" ON "document"("storageKey");

-- CreateIndex
CREATE INDEX "document_applicationId_docType_idx" ON "document"("applicationId", "docType");

-- CreateIndex
CREATE INDEX "document_status_createdAt_idx" ON "document"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "correction_request_applicationId_round_key" ON "correction_request"("applicationId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "fee_assessment_applicationId_key" ON "fee_assessment"("applicationId");

-- CreateIndex
CREATE INDEX "outbox_event_dispatchedAt_createdAt_idx" ON "outbox_event"("dispatchedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_serviceVersionId_fkey" FOREIGN KEY ("serviceVersionId") REFERENCES "service_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application" ADD CONSTRAINT "application_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_data" ADD CONSTRAINT "application_data_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_history" ADD CONSTRAINT "application_status_history_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_request" ADD CONSTRAINT "correction_request_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_item" ADD CONSTRAINT "correction_item_correctionRequestId_fkey" FOREIGN KEY ("correctionRequestId") REFERENCES "correction_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_assessment" ADD CONSTRAINT "fee_assessment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Hand-written constraints (ADR-0002) ───────────────────────────────────

-- FR-034: reference numbers GS-YYYY-NNNNNN draw from one global sequence.
CREATE SEQUENCE "application_ref_seq" START 1;

-- FR-031: one open STANDARD application per applicant, service and subject.
-- Drafts for a child have no subject key until submit, so they are not constrained yet.
CREATE UNIQUE INDEX "application_one_open_per_subject"
  ON "application" ("applicantId", "serviceId", "subjectKey")
  WHERE "kind" = 'STANDARD' AND "subjectKey" IS NOT NULL
    AND "status" NOT IN ('ISSUED', 'REJECTED', 'REFERRED', 'WITHDRAWN', 'ABANDONED');

ALTER TABLE "application" ADD CONSTRAINT "application_extra_copies_chk" CHECK ("extraCopies" BETWEEN 0 AND 5);
ALTER TABLE "application" ADD CONSTRAINT "application_correction_round_chk" CHECK ("correctionRound" >= 0);
ALTER TABLE "fee_assessment" ADD CONSTRAINT "fee_assessment_total_non_negative_chk" CHECK ("totalCents" >= 0);
ALTER TABLE "document" ADD CONSTRAINT "document_size_chk" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 5242880);
