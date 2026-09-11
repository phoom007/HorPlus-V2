-- AlterTable
ALTER TABLE "dormitory_billing_settings" ADD COLUMN "water_tier_rates" JSONB,
ADD COLUMN "electricity_tier_rates" JSONB;

-- AlterTable
ALTER TABLE "billing_rate_snapshots" ADD COLUMN "water_tier_rates" JSONB,
ADD COLUMN "electricity_tier_rates" JSONB;
