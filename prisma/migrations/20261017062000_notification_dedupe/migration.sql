-- Idempotency key for scheduled notifications (e.g. one deadline reminder per
-- assessment and recipient). NULL keys do not participate in the unique index.
ALTER TABLE "notifications" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "notifications_dedupeKey_key" ON "notifications" ("dedupeKey");
