-- A rotated refresh token may be presented once more within the grace period (two tabs refreshing
-- together); this records that the one extra use is spent, so a further replay revokes the family.
ALTER TABLE "refresh_token" ADD COLUMN "graceUsedAt" TIMESTAMPTZ(3);
