-- CreateEnum
CREATE TYPE "InPersonStep" AS ENUM ('NONE', 'FINGERPRINTS', 'APPEARANCE');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('SINGLE', 'SUPERVISOR_SECOND', 'SUPERVISOR_ON_RECORD_FOUND');

-- CreateEnum
CREATE TYPE "SubjectMode" AS ENUM ('SELF', 'SELF_OR_CHILD');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ReasonCodeKind" AS ENUM ('REJECT', 'PAYMENT_REJECT', 'REVOKE', 'REFUND_DECLINE');

-- CreateTable
CREATE TABLE "service" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "departmentId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "slaWorkingDays" INTEGER NOT NULL,
    "inPersonStep" "InPersonStep" NOT NULL,
    "approvalMode" "ApprovalMode" NOT NULL,
    "validityMonths" INTEGER,
    "certificatePrefix" TEXT NOT NULL,
    "subjectMode" "SubjectMode" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_version" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "formSchema" JSONB NOT NULL,
    "uiSchema" JSONB NOT NULL,
    "requiredDocuments" JSONB NOT NULL,
    "feeBaseCents" BIGINT NOT NULL,
    "feePerCopyCents" BIGINT NOT NULL,
    "feeIsTest" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" UUID,
    "retiredAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "holiday" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "reason_code" (
    "id" UUID NOT NULL,
    "kind" "ReasonCodeKind" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reason_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_code_key" ON "service"("code");

-- CreateIndex
CREATE UNIQUE INDEX "service_certificatePrefix_key" ON "service"("certificatePrefix");

-- CreateIndex
CREATE INDEX "service_version_serviceId_status_idx" ON "service_version"("serviceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_version_serviceId_versionNo_key" ON "service_version"("serviceId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "reason_code_kind_code_key" ON "reason_code"("kind", "code");

-- AddForeignKey
ALTER TABLE "service" ADD CONSTRAINT "service_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_version" ADD CONSTRAINT "service_version_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Hand-written constraints (ADR-0002) ───────────────────────────────────

-- FR-022: at most one published version per service, and at most one draft being edited.
CREATE UNIQUE INDEX "service_version_one_published" ON "service_version" ("serviceId") WHERE "status" = 'PUBLISHED';
CREATE UNIQUE INDEX "service_version_one_draft" ON "service_version" ("serviceId") WHERE "status" = 'DRAFT';

-- FR-040: fees are non-negative integer cents.
ALTER TABLE "service_version" ADD CONSTRAINT "service_version_fees_non_negative_chk"
  CHECK ("feeBaseCents" >= 0 AND "feePerCopyCents" >= 0);

ALTER TABLE "service" ADD CONSTRAINT "service_sla_positive_chk" CHECK ("slaWorkingDays" > 0);
ALTER TABLE "service" ADD CONSTRAINT "service_validity_positive_chk" CHECK ("validityMonths" IS NULL OR "validityMonths" > 0);
