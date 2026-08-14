-- AlterTable
ALTER TABLE "room_next_cycle_corrections" ADD COLUMN "source_billing_cycle_id" UUID,
ADD COLUMN "effective_after_period_start" TIMESTAMPTZ;
