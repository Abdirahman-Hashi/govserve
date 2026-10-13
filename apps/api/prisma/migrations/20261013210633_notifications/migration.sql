-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SKIPPED', 'DEAD');

-- AlterTable
ALTER TABLE "application" ADD COLUMN     "slaBreachedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventId" UUID,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "template" TEXT NOT NULL,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "userId" UUID NOT NULL,
    "emailOptional" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "notification_userId_createdAt_idx" ON "notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notification_status_updatedAt_idx" ON "notification"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_eventId_channel_userId_key" ON "notification"("eventId", "channel", "userId");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "outbox_event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: a mandatory message is never skipped by a preference.
ALTER TABLE "notification" ADD CONSTRAINT "notification_skip_optional_chk"
  CHECK ("status" <> 'SKIPPED' OR "mandatory" = false);

-- Hand-written: events written before the relay existed (Phases 04–06) are not emailed retroactively.
UPDATE "outbox_event" SET "dispatchedAt" = now() WHERE "dispatchedAt" IS NULL;
