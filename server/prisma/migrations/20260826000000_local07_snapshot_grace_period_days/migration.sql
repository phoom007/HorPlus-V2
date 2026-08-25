-- AlterTable
ALTER TABLE "billing_rate_snapshots" ADD COLUMN "grace_period_days" INTEGER NOT NULL DEFAULT 0;

-- Backfill from dormitory_billing_settings
UPDATE "billing_rate_snapshots" brs
SET "grace_period_days" = dbs."grace_period_days"
FROM "dormitory_billing_settings" dbs
WHERE brs."dormitory_id" = dbs."dormitory_id";
