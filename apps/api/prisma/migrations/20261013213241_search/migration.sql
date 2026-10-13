-- DropIndex
DROP INDEX "application_applicantId_createdAt_idx";

-- DropIndex
DROP INDEX "payment_applicationId_idx";

-- CreateIndex
CREATE INDEX "application_applicantId_createdAt_id_idx" ON "application"("applicantId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "application_departmentId_createdAt_id_idx" ON "application"("departmentId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "payment_applicationId_createdAt_idx" ON "payment"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_createdAt_id_idx" ON "payment"("createdAt" DESC, "id" DESC);

-- Hand-written (Prisma cannot express these). Names use the 'simple' configuration: no stemming of Somali names.
CREATE INDEX "user_fullName_fts_idx" ON "user"
  USING GIN (to_tsvector('simple', coalesce("fullName", '')));
CREATE INDEX "application_data_subjectFullName_fts_idx" ON "application_data"
  USING GIN (to_tsvector('simple', coalesce("subjectFullName", '')));
-- Partial reference-number search (ILIKE '%…%').
CREATE INDEX "application_referenceNo_trgm_idx" ON "application"
  USING GIN ("referenceNo" gin_trgm_ops);
