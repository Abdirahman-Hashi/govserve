-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('MOBILE_MONEY', 'BANK', 'CASH', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING_VERIFICATION', 'AWAITING_SUPERVISOR', 'CONFIRMED', 'REJECTED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('WITHDRAWN_BEFORE_REVIEW', 'DUPLICATE_PAYMENT', 'OVERPAYMENT', 'ABANDONED_UNPAID');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'DECLINED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SigningKeyStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "referenceNorm" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "paidAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "idempotencyKey" TEXT,
    "payerName" TEXT,
    "evidenceDocumentId" UUID,
    "recordedById" UUID,
    "firstConfirmedById" UUID,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMPTZ(3),
    "rejectReasonCodeId" UUID,
    "rejectNote" TEXT,
    "overpaidCents" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_event" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" "PaymentStatus",
    "toStatus" "PaymentStatus",
    "actorId" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "providerEventId" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedById" UUID,
    "approvedById" UUID,
    "payoutMethod" "PaymentChannel",
    "payoutReference" TEXT,
    "providerRefundId" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt" (
    "id" UUID NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "paymentId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "signature" BYTEA NOT NULL,
    "keyId" TEXT NOT NULL,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counter" (
    "name" TEXT NOT NULL,
    "nextValue" BIGINT NOT NULL,

    CONSTRAINT "counter_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "signing_key" (
    "id" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'Ed25519',
    "publicKey" BYTEA NOT NULL,
    "status" "SigningKeyStatus" NOT NULL,
    "activatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "signing_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_idempotencyKey_key" ON "payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_applicationId_idx" ON "payment"("applicationId");

-- CreateIndex
CREATE INDEX "payment_status_createdAt_idx" ON "payment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_event_providerEventId_key" ON "payment_event"("providerEventId");

-- CreateIndex
CREATE INDEX "payment_event_paymentId_at_idx" ON "payment_event"("paymentId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "refund_providerRefundId_key" ON "refund"("providerRefundId");

-- CreateIndex
CREATE INDEX "refund_paymentId_idx" ON "refund"("paymentId");

-- CreateIndex
CREATE INDEX "refund_status_createdAt_idx" ON "refund"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_receiptNo_key" ON "receipt"("receiptNo");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_paymentId_key" ON "receipt"("paymentId");

-- CreateIndex
CREATE INDEX "receipt_applicationId_idx" ON "receipt"("applicationId");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "signing_key"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Hand-written constraints (ADR-0002) ───────────────────────────────────

-- FR-052: a transaction ID / slip number / receipt-book reference is used once (rejected ones are released).
CREATE UNIQUE INDEX "payment_reference_unique_active"
  ON "payment" ("channel", "provider", "referenceNorm") WHERE "status" <> 'REJECTED';

ALTER TABLE "payment" ADD CONSTRAINT "payment_amount_positive_chk" CHECK ("amountCents" > 0);
ALTER TABLE "payment" ADD CONSTRAINT "payment_overpaid_range_chk" CHECK ("overpaidCents" >= 0 AND "overpaidCents" <= "amountCents");
-- FR-054: the second confirmation is by a different person.
ALTER TABLE "payment" ADD CONSTRAINT "payment_two_people_chk"
  CHECK ("firstConfirmedById" IS NULL OR "confirmedById" IS NULL OR "firstConfirmedById" <> "confirmedById");

ALTER TABLE "refund" ADD CONSTRAINT "refund_amount_positive_chk" CHECK ("amountCents" > 0);
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_amount_positive_chk" CHECK ("amountCents" > 0);
ALTER TABLE "counter" ADD CONSTRAINT "counter_positive_chk" CHECK ("nextValue" > 0);
