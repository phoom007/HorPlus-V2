-- R2.1 Hardening Migration: Set Room cycle deposits NOT NULL
-- 1. Ensure no NULL values exist in cycle deposits (fallback to legacy deposit_amount or 0.00)
UPDATE "rooms"
SET
  "term_deposit" = COALESCE("term_deposit", "deposit_amount", 0.00),
  "monthly_deposit" = COALESCE("monthly_deposit", "deposit_amount", 0.00),
  "daily_deposit" = COALESCE("daily_deposit", "deposit_amount", 0.00)
WHERE "term_deposit" IS NULL OR "monthly_deposit" IS NULL OR "daily_deposit" IS NULL;

-- 2. Alter columns to NOT NULL (no static DB default)
ALTER TABLE "rooms" ALTER COLUMN "term_deposit" SET NOT NULL;
ALTER TABLE "rooms" ALTER COLUMN "monthly_deposit" SET NOT NULL;
ALTER TABLE "rooms" ALTER COLUMN "daily_deposit" SET NOT NULL;
