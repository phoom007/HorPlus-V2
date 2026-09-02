-- AlterTable
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "monthly_deposit" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "term_deposit" DECIMAL(12,2),
ADD COLUMN IF NOT EXISTS "daily_deposit" DECIMAL(12,2);
