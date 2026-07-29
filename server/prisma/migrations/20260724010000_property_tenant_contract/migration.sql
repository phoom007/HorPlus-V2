-- Migration: Property, Tenant, Contract & Occupancy RLS
-- Created At: 2026-07-24T01:00:00.000Z

-- Enable btree_gist extension for PostgreSQL exclusion constraint
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Create Table buildings
CREATE TABLE IF NOT EXISTS "buildings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(100),
    "floor_count" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- Create Table rooms
CREATE TABLE IF NOT EXISTS "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "building_id" UUID,
    "room_number" VARCHAR(100) NOT NULL,
    "floor" INTEGER NOT NULL DEFAULT 1,
    "room_type" VARCHAR(100) NOT NULL DEFAULT 'standard',
    "status" VARCHAR(50) NOT NULL DEFAULT 'vacant',
    "rent_cycle" VARCHAR(50) NOT NULL DEFAULT 'monthly',
    "monthly_rent" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "term_rent" DECIMAL(12,2),
    "daily_rent" DECIMAL(12,2),
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "parking_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "maximum_occupants" INTEGER NOT NULL DEFAULT 2,
    "water_meter_number" VARCHAR(100),
    "electricity_meter_number" VARCHAR(100),
    "initial_water_reading" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "initial_electricity_reading" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "amenities" JSONB,
    "images" JSONB,
    "notes" TEXT,
    "current_tenant_id" UUID,
    "current_contract_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- Create Table tenants
CREATE TABLE IF NOT EXISTS "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "linked_user_id" UUID,
    "tenant_number" VARCHAR(100) NOT NULL,
    "first_name" VARCHAR(255) NOT NULL,
    "last_name" VARCHAR(255),
    "display_name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "email" VARCHAR(255),
    "national_id_encrypted" TEXT,
    "national_id_masked" VARCHAR(255),
    "date_of_birth" DATE,
    "gender" VARCHAR(50),
    "address" TEXT,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "photo_url" TEXT,
    "pet_info" JSONB,
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- Create Table tenant_co_occupants
CREATE TABLE IF NOT EXISTS "tenant_co_occupants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50),
    "relationship" VARCHAR(100),
    "national_id_encrypted" TEXT,
    "national_id_masked" VARCHAR(255),
    "date_of_birth" DATE,
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tenant_co_occupants_pkey" PRIMARY KEY ("id")
);

-- Create Table tenant_emergency_contacts
CREATE TABLE IF NOT EXISTS "tenant_emergency_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "relationship" VARCHAR(100) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- Create Table tenant_vehicles
CREATE TABLE IF NOT EXISTS "tenant_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'car',
    "brand" VARCHAR(100),
    "model" VARCHAR(100),
    "color" VARCHAR(50),
    "license_plate" VARCHAR(100) NOT NULL,
    "province" VARCHAR(100),
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tenant_vehicles_pkey" PRIMARY KEY ("id")
);

-- Create Table contracts
CREATE TABLE IF NOT EXISTS "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "contract_number" VARCHAR(100) NOT NULL,
    "room_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'draft',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "duration_months" INTEGER NOT NULL DEFAULT 1,
    "rent_billing_type" VARCHAR(50) NOT NULL DEFAULT 'monthly',
    "rent_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "advance_payment_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "terms" TEXT,
    "tenant_signature" TEXT,
    "owner_signature" TEXT,
    "signed_by_owner_at" TIMESTAMPTZ(6),
    "signed_by_tenant_at" TIMESTAMPTZ(6),
    "activated_at" TIMESTAMPTZ(6),
    "terminated_at" TIMESTAMPTZ(6),
    "termination_effective_date" DATE,
    "termination_reason" TEXT,
    "settlement_summary" JSONB,
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- Create Table contract_status_histories
CREATE TABLE IF NOT EXISTS "contract_status_histories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "from_status" VARCHAR(50),
    "to_status" VARCHAR(50) NOT NULL,
    "reason" TEXT,
    "effective_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_user_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_status_histories_pkey" PRIMARY KEY ("id")
);

-- Unique Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "buildings_dormitory_id_code_key" ON "buildings"("dormitory_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "buildings_dormitory_id_name_key" ON "buildings"("dormitory_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "rooms_dormitory_id_room_number_key" ON "rooms"("dormitory_id", "room_number");
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_dormitory_id_tenant_number_key" ON "tenants"("dormitory_id", "tenant_number");
CREATE UNIQUE INDEX IF NOT EXISTS "contracts_dormitory_id_contract_number_key" ON "contracts"("dormitory_id", "contract_number");

-- Foreign Keys
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_co_occupants" ADD CONSTRAINT "tenant_co_occupants_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_co_occupants" ADD CONSTRAINT "tenant_co_occupants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_emergency_contacts" ADD CONSTRAINT "tenant_emergency_contacts_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_emergency_contacts" ADD CONSTRAINT "tenant_emergency_contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_vehicles" ADD CONSTRAINT "tenant_vehicles_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tenant_vehicles" ADD CONSTRAINT "tenant_vehicles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_status_histories" ADD CONSTRAINT "contract_status_histories_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- EXCLUSION CONSTRAINT FOR CONTRACT ROOM OVERLAP PREVENTION (Half-open interval [start_date, end_date))
ALTER TABLE "contracts" DROP CONSTRAINT IF EXISTS "contracts_room_no_overlap_excl";
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_room_no_overlap_excl"
  EXCLUDE USING gist (
    "room_id" WITH =,
    daterange("start_date", "end_date", '[)') WITH &&
  )
  WHERE ("status" IN ('active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out') AND "deleted_at" IS NULL);

-- ROW LEVEL SECURITY POLICIES FOR MULTI-DORMITORY ISOLATION
ALTER TABLE "buildings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_co_occupants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_emergency_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_vehicles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_status_histories" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "buildings_dormitory_isolation" ON "buildings" FOR ALL USING ("dormitory_id"::text = NULLIF(current_setting('app.current_dormitory_id', true), ''));
CREATE POLICY "rooms_dormitory_isolation" ON "rooms" FOR ALL USING ("dormitory_id"::text = NULLIF(current_setting('app.current_dormitory_id', true), ''));
CREATE POLICY "tenants_dormitory_isolation" ON "tenants" FOR ALL USING ("dormitory_id"::text = NULLIF(current_setting('app.current_dormitory_id', true), ''));
CREATE POLICY "tenant_co_occupants_isolation" ON "tenant_co_occupants" FOR ALL USING ("dormitory_id"::text = NULLIF(current_setting('app.current_dormitory_id', true), ''));
CREATE POLICY "tenant_emergency_contacts_isolation" ON "tenant_emergency_contacts" FOR ALL USING ("dormitory_id"::text = NULLIF(current_setting('app.current_dormitory_id', true), ''));
CREATE POLICY "tenant_vehicles_isolation" ON "tenant_vehicles" FOR ALL USING ("dormitory_id"::text = NULLIF(current_setting('app.current_dormitory_id', true), ''));
CREATE POLICY "contracts_dormitory_isolation" ON "contracts" FOR ALL USING ("dormitory_id"::text = NULLIF(current_setting('app.current_dormitory_id', true), ''));
CREATE POLICY "contract_status_histories_isolation" ON "contract_status_histories" FOR ALL USING ("dormitory_id"::text = NULLIF(current_setting('app.current_dormitory_id', true), ''));
