-- AlterTable
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "term_months" INTEGER DEFAULT 6;

-- AlterTable
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "term_months" INTEGER DEFAULT 6;
