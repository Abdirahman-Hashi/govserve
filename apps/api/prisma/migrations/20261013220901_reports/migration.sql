-- CreateIndex
CREATE INDEX "payment_event_at_idx" ON "payment_event"("at");

-- Hand-written: reporting views (Phase 09, FR-120/FR-121). Queried live so every figure reconciles
-- with the transaction tables. Amounts stay bigint cents.

-- One row per money movement, dated when it happened:
--   CONFIRMED (+): a payment entering CONFIRMED (P3 cash, P5, P8, P10 card)
--   REVERSED  (-): a confirmed card payment reversed (P9)
--   REFUNDED  (-): a refund completed (R4), with the original payment's channel
CREATE VIEW "report_money_movement" AS
SELECT pe."id" AS "eventId", pe."at" AS "occurredAt", 'CONFIRMED'::text AS "kind",
       p."id" AS "paymentId", a."id" AS "applicationId", a."referenceNo", a."departmentId",
       a."serviceId", s."code" AS "serviceCode", s."name" AS "serviceName", p."channel",
       p."amountCents" AS "amountCents"
FROM "payment_event" pe
JOIN "payment" p ON p."id" = pe."paymentId"
JOIN "application" a ON a."id" = p."applicationId"
JOIN "service" s ON s."id" = a."serviceId"
WHERE pe."toStatus" = 'CONFIRMED'
UNION ALL
SELECT pe."id", pe."at", 'REVERSED', p."id", a."id", a."referenceNo", a."departmentId",
       a."serviceId", s."code", s."name", p."channel", p."amountCents"
FROM "payment_event" pe
JOIN "payment" p ON p."id" = pe."paymentId"
JOIN "application" a ON a."id" = p."applicationId"
JOIN "service" s ON s."id" = a."serviceId"
WHERE pe."toStatus" = 'REVERSED'
UNION ALL
SELECT pe."id", pe."at", 'REFUNDED', p."id", a."id", a."referenceNo", a."departmentId",
       a."serviceId", s."code", s."name", p."channel", r."amountCents"
FROM "payment_event" pe
JOIN "refund" r ON r."id" = (pe."payload"->>'refundId')::uuid
JOIN "payment" p ON p."id" = r."paymentId"
JOIN "application" a ON a."id" = p."applicationId"
JOIN "service" s ON s."id" = a."serviceId"
WHERE pe."type" = 'REFUND_COMPLETED';

-- One row per submitted application with what the dashboard needs.
CREATE VIEW "report_application" AS
SELECT a."id", a."referenceNo", a."kind", a."status", a."departmentId", a."serviceId",
       s."code" AS "serviceCode", s."name" AS "serviceName", a."assigneeId",
       a."createdAt", a."submittedAt", a."queuedAt", a."decidedAt", a."claimExpiresAt",
       a."slaDueAt", a."slaPausedAt",
       COALESCE(fa."totalCents", 0) AS "assessedCents",
       COALESCE(paid."cents", 0) AS "paidCents",
       CASE WHEN a."status" = 'AWAITING_PAYMENT'
            THEN GREATEST(COALESCE(fa."totalCents", 0) - COALESCE(paid."cents", 0), 0)
            ELSE 0 END AS "outstandingCents"
FROM "application" a
JOIN "service" s ON s."id" = a."serviceId"
LEFT JOIN "fee_assessment" fa ON fa."applicationId" = a."id"
LEFT JOIN LATERAL (
  SELECT SUM(p."amountCents")::bigint AS "cents" FROM "payment" p
  WHERE p."applicationId" = a."id" AND p."status" = 'CONFIRMED'
) paid ON true
WHERE a."status" <> 'DRAFT';
