-- Set default to 2 on dormitory_billing_settings.grace_period_days
ALTER TABLE "dormitory_billing_settings" ALTER COLUMN "grace_period_days" SET DEFAULT 2;

-- Set default to 2 on billing_rate_snapshots.grace_period_days
ALTER TABLE "billing_rate_snapshots" ALTER COLUMN "grace_period_days" SET DEFAULT 2;

-- Normalize all existing dormitory_billing_settings rows to 2 (Product Policy Normalization)
UPDATE "dormitory_billing_settings" SET "grace_period_days" = 2;

-- Normalize all existing billing_rate_snapshots rows to 2 (Product Policy Normalization)
UPDATE "billing_rate_snapshots" SET "grace_period_days" = 2;