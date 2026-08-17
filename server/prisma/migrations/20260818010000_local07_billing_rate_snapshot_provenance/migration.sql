-- Migration: 20260818010000_local07_billing_rate_snapshot_provenance

-- AlterTable: Add provenance columns to billing_rate_snapshots
ALTER TABLE "billing_rate_snapshots"
  ADD COLUMN "source" VARCHAR(50),
  ADD COLUMN "inherited_from_billing_cycle_id" UUID,
  ADD COLUMN "updated_by_user_id" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Classify legacy rows safely as TEMPLATE_DEFAULT
UPDATE "billing_rate_snapshots"
  SET "source" = 'TEMPLATE_DEFAULT',
      "updated_at" = "created_at"
  WHERE "source" IS NULL;

-- Make source NOT NULL without automatic database default
ALTER TABLE "billing_rate_snapshots"
  ALTER COLUMN "source" SET NOT NULL;

-- Source domain CHECK constraint
ALTER TABLE "billing_rate_snapshots"
  ADD CONSTRAINT "billing_rate_snapshots_source_check"
  CHECK ("source" IN ('TEMPLATE_DEFAULT', 'INHERITED', 'MANUAL_OVERRIDE'));

-- Provenance consistency CHECK constraint
ALTER TABLE "billing_rate_snapshots"
  ADD CONSTRAINT "billing_rate_snapshots_provenance_check"
  CHECK (
    (
      "source" = 'TEMPLATE_DEFAULT'
      AND "inherited_from_billing_cycle_id" IS NULL
      AND "updated_by_user_id" IS NULL
    )
    OR
    (
      "source" = 'INHERITED'
      AND "inherited_from_billing_cycle_id" IS NOT NULL
      AND "updated_by_user_id" IS NULL
    )
    OR
    (
      "source" = 'MANUAL_OVERRIDE'
      AND "inherited_from_billing_cycle_id" IS NULL
      AND "updated_by_user_id" IS NOT NULL
    )
  );

-- Unique constraint on billing_cycle_id (1 snapshot per billing cycle)
CREATE UNIQUE INDEX "billing_rate_snapshots_billing_cycle_id_key"
  ON "billing_rate_snapshots"("billing_cycle_id");

ALTER TABLE "billing_rate_snapshots"
  ADD CONSTRAINT "billing_rate_snapshots_billing_cycle_id_key"
  UNIQUE USING INDEX "billing_rate_snapshots_billing_cycle_id_key";

-- Inheritance parent index
CREATE INDEX "billing_rate_snapshots_inherited_from_billing_cycle_id_idx"
  ON "billing_rate_snapshots"("inherited_from_billing_cycle_id");

-- Foreign key for inheritance parent
ALTER TABLE "billing_rate_snapshots"
  ADD CONSTRAINT "billing_rate_snapshots_inherited_from_billing_cycle_id_fkey"
  FOREIGN KEY ("inherited_from_billing_cycle_id")
  REFERENCES "billing_cycles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
