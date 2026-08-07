-- Migration: Wave 1G Property, Building, Room Defaults, Availability and Contract Snapshot
-- Created: 2026-08-05 21:00:00

-- 1. Create dormitory_property_defaults table
CREATE TABLE IF NOT EXISTS "dormitory_property_defaults" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "default_monthly_rent" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "default_term_rent" DECIMAL(12,2),
    "default_daily_rent" DECIMAL(12,2),
    "default_deposit" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "default_advance_payment" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "default_parking_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "default_max_occupants" INTEGER NOT NULL DEFAULT 2,
    "default_room_type" VARCHAR(100) NOT NULL DEFAULT 'standard',
    "default_terms" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dormitory_property_defaults_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dormitory_property_defaults_dormitory_id_key" ON "dormitory_property_defaults"("dormitory_id");
ALTER TABLE "dormitory_property_defaults" ADD CONSTRAINT "dormitory_property_defaults_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Add version to dormitory_billing_settings
ALTER TABLE "dormitory_billing_settings" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- 3. Add override columns and version to buildings
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "monthly_rent" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "term_rent" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "daily_rent" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "deposit_amount" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "advance_payment_amount" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "water_rate" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "electricity_rate" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "common_fee" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "internet_fee" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "parking_fee" DECIMAL(12,2);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "water_billing_type" VARCHAR(50);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "electricity_billing_type" VARCHAR(50);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "rent_billing_type" VARCHAR(50);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "maximum_occupants" INTEGER;
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "room_type" VARCHAR(100);
ALTER TABLE "buildings" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- 4. Add override columns to rooms
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "advance_payment_amount" DECIMAL(12,2);
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "water_rate" DECIMAL(12,2);
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "electricity_rate" DECIMAL(12,2);
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "common_fee" DECIMAL(12,2);
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "internet_fee" DECIMAL(12,2);
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "water_billing_type" VARCHAR(50);
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "electricity_billing_type" VARCHAR(50);
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "rent_billing_type" VARCHAR(50);

-- Make room overrides nullable so null means inherit
ALTER TABLE "rooms" ALTER COLUMN "monthly_rent" DROP NOT NULL;
ALTER TABLE "rooms" ALTER COLUMN "monthly_rent" DROP DEFAULT;
ALTER TABLE "rooms" ALTER COLUMN "deposit_amount" DROP NOT NULL;
ALTER TABLE "rooms" ALTER COLUMN "deposit_amount" DROP DEFAULT;
ALTER TABLE "rooms" ALTER COLUMN "parking_fee" DROP NOT NULL;
ALTER TABLE "rooms" ALTER COLUMN "parking_fee" DROP DEFAULT;
ALTER TABLE "rooms" ALTER COLUMN "maximum_occupants" DROP NOT NULL;
ALTER TABLE "rooms" ALTER COLUMN "maximum_occupants" DROP DEFAULT;
ALTER TABLE "rooms" ALTER COLUMN "room_type" DROP DEFAULT;

-- 5. Backfill normalized_room_number for existing rooms
UPDATE "rooms"
SET "normalized_room_number" = LOWER(TRIM("room_number"))
WHERE "normalized_room_number" IS NULL OR "normalized_room_number" = '';

-- Check constraint on normalized_room_number non-blank
ALTER TABLE "rooms" ADD CONSTRAINT "chk_rooms_normalized_room_number_not_empty" CHECK (length(trim("normalized_room_number")) > 0);

-- Ensure index and unique constraint on dormitoryId + normalizedRoomNumber exist
CREATE UNIQUE INDEX IF NOT EXISTS "dormitory_normalized_room_number_unique" ON "rooms"("dormitory_id", "normalized_room_number");

-- 6. Create contract_snapshots table
CREATE TABLE IF NOT EXISTS "contract_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "exact_room_number" VARCHAR(100) NOT NULL,
    "resolved_rent" DECIMAL(12,2) NOT NULL,
    "resolved_deposit" DECIMAL(12,2) NOT NULL,
    "resolved_advance_payment" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "resolved_water_rate" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "resolved_electricity_rate" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "resolved_common_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "resolved_internet_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "resolved_parking_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "water_billing_type" VARCHAR(50) NOT NULL DEFAULT 'per_unit',
    "electricity_billing_type" VARCHAR(50) NOT NULL DEFAULT 'per_unit',
    "rent_billing_type" VARCHAR(50) NOT NULL DEFAULT 'monthly',
    "installment_config" JSONB,
    "terms_version" VARCHAR(100),
    "source_versions" JSONB NOT NULL,
    "snapshot_data" JSONB NOT NULL,
    "locked_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "contract_snapshots_contract_id_key" ON "contract_snapshots"("contract_id");
ALTER TABLE "contract_snapshots" ADD CONSTRAINT "contract_snapshots_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_snapshots" ADD CONSTRAINT "contract_snapshots_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Create audit_logs table
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" VARCHAR(255) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "before_values" JSONB,
    "after_values" JSONB,
    "changed_fields" JSONB,
    "reason" TEXT,
    "request_id" VARCHAR(255),
    "version_before" INTEGER,
    "version_after" INTEGER,
    "idempotency_key" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_dormitory_id_idx" ON "audit_logs"("dormitory_id");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. Add non-negative check constraints on financial columns
ALTER TABLE "dormitory_property_defaults" ADD CONSTRAINT "chk_prop_def_monthly_rent" CHECK ("default_monthly_rent" >= 0);
ALTER TABLE "dormitory_property_defaults" ADD CONSTRAINT "chk_prop_def_deposit" CHECK ("default_deposit" >= 0);
ALTER TABLE "dormitory_property_defaults" ADD CONSTRAINT "chk_prop_def_advance" CHECK ("default_advance_payment" >= 0);
ALTER TABLE "dormitory_property_defaults" ADD CONSTRAINT "chk_prop_def_parking" CHECK ("default_parking_fee" >= 0);
ALTER TABLE "dormitory_property_defaults" ADD CONSTRAINT "chk_prop_def_max_occ" CHECK ("default_max_occupants" > 0);

-- Backfill DormitoryPropertyDefaults for existing dormitories that don't have one
INSERT INTO "dormitory_property_defaults" ("dormitory_id", "default_monthly_rent", "default_deposit", "default_advance_payment", "default_parking_fee", "default_max_occupants", "default_room_type")
SELECT
    d."id",
    0.00,
    0.00,
    0.00,
    0.00,
    2,
    'standard'
FROM "dormitories" d
ON CONFLICT ("dormitory_id") DO NOTHING;
