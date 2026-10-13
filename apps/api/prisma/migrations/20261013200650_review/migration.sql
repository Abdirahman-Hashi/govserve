-- CreateEnum
CREATE TYPE "AppointmentKind" AS ENUM ('FINGERPRINTS', 'APPEARANCE');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'ATTENDED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewLevel" AS ENUM ('OFFICER', 'SUPERVISOR');

-- CreateEnum
CREATE TYPE "ReviewDecisionKind" AS ENUM ('APPROVE', 'FORWARD', 'RETURN', 'REJECT', 'REFER');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('VALID', 'REVOKED');

-- CreateEnum
CREATE TYPE "RevokeReason" AS ENUM ('FRAUD', 'ERROR', 'CHARGEBACK', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "correction_request" ADD COLUMN     "reminder1At" TIMESTAMPTZ(3),
ADD COLUMN     "reminder7At" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "appointment" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "kind" "AppointmentKind" NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "location" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "attendees" JSONB,
    "scheduledById" UUID NOT NULL,
    "recordedById" UUID,
    "recordedAt" TIMESTAMPTZ(3),
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decision" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "level" "ReviewLevel" NOT NULL,
    "decision" "ReviewDecisionKind" NOT NULL,
    "outcome" "ReviewOutcome",
    "reasonCodeId" UUID,
    "note" TEXT,
    "noteEnc" BYTEA,
    "decidedById" UUID NOT NULL,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate" (
    "id" UUID NOT NULL,
    "certificateNo" TEXT NOT NULL,
    "applicationId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "holderUserId" UUID NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "holderNameMasked" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "status" "CertificateStatus" NOT NULL DEFAULT 'VALID',
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,
    "revokeReason" "RevokeReason",
    "revokeNote" TEXT,
    "duplicateOfId" UUID,
    "supersededById" UUID,
    "payloadJson" JSONB NOT NULL,
    "signature" BYTEA NOT NULL,
    "keyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_applicationId_idx" ON "appointment"("applicationId");

-- CreateIndex
CREATE INDEX "appointment_status_scheduledAt_idx" ON "appointment"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "review_decision_applicationId_decidedAt_idx" ON "review_decision"("applicationId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_certificateNo_key" ON "certificate"("certificateNo");

-- CreateIndex
CREATE INDEX "certificate_serviceId_subjectKey_status_idx" ON "certificate"("serviceId", "subjectKey", "status");

-- CreateIndex
CREATE INDEX "certificate_holderUserId_idx" ON "certificate"("holderUserId");

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "signing_key"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "certificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Hand-written constraints (ADR-0002) ───────────────────────────────────

-- FR-074: at most one scheduled appointment per application.
CREATE UNIQUE INDEX "appointment_one_scheduled" ON "appointment" ("applicationId") WHERE "status" = 'SCHEDULED';
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_reschedules_chk" CHECK ("rescheduleCount" BETWEEN 0 AND 10);

-- FR-095: at most one VALID standard certificate per service and subject (duplicates are copies of it).
CREATE UNIQUE INDEX "certificate_one_valid_per_subject"
  ON "certificate" ("serviceId", "subjectKey") WHERE "status" = 'VALID' AND "duplicateOfId" IS NULL;

ALTER TABLE "certificate" ADD CONSTRAINT "certificate_revocation_chk"
  CHECK (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL AND "revokeReason" IS NOT NULL));

-- FR-014 / A18 / A19: the supervisor who decides must not be the officer who forwarded the application.
CREATE FUNCTION "review_decision_second_person"() RETURNS trigger AS $$
BEGIN
  IF NEW."level" = 'SUPERVISOR' AND EXISTS (
    SELECT 1 FROM "review_decision" d
    WHERE d."applicationId" = NEW."applicationId"
      AND d."level" = 'OFFICER'
      AND d."decision" = 'FORWARD'
      AND d."decidedById" = NEW."decidedById"
      AND d."decidedAt" = (
        SELECT max(x."decidedAt") FROM "review_decision" x
        WHERE x."applicationId" = NEW."applicationId" AND x."level" = 'OFFICER' AND x."decision" = 'FORWARD'
      )
  ) THEN
    RAISE EXCEPTION 'second approval must be by a different person' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "review_decision_second_person_trg"
  BEFORE INSERT ON "review_decision"
  FOR EACH ROW EXECUTE FUNCTION "review_decision_second_person"();
