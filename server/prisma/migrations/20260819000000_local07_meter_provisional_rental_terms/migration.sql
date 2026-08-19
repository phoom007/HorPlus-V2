-- Migration: 20260819000000_local07_meter_provisional_rental_terms

-- 1. AlterTable: Make Tenant.phone nullable
ALTER TABLE "tenants"
  ALTER COLUMN "phone" DROP NOT NULL;

-- 2. AlterTable: RoomBillingCycleSnapshot default peopleCount to 0 for new snapshots, add manual cycle charge fields
ALTER TABLE "room_billing_cycle_snapshots"
  ALTER COLUMN "people_count" SET DEFAULT 0;

ALTER TABLE "room_billing_cycle_snapshots"
  ADD COLUMN "manual_outstanding_amount" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN "other_fees" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. CreateTable: provisional_rental_terms
CREATE TABLE "provisional_rental_terms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dormitory_id" UUID NOT NULL,
  "room_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "occupancy_id" UUID,
  "rental_type" VARCHAR(50) NOT NULL,
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "duration_months" INTEGER NOT NULL DEFAULT 1,
  "unit_rent_amount" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  "total_rent_amount" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  "term_months_snapshot" INTEGER,
  "term_installment_count" INTEGER,
  "status" VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID,
  "converted_contract_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "provisional_rental_terms_pkey" PRIMARY KEY ("id")
);

-- Indexes for provisional_rental_terms
CREATE INDEX "provisional_rental_terms_dormitory_id_idx" ON "provisional_rental_terms"("dormitory_id");
CREATE INDEX "provisional_rental_terms_room_id_idx" ON "provisional_rental_terms"("room_id");
CREATE INDEX "provisional_rental_terms_tenant_id_idx" ON "provisional_rental_terms"("tenant_id");
CREATE INDEX "provisional_rental_terms_dormitory_id_room_id_status_idx" ON "provisional_rental_terms"("dormitory_id", "room_id", "status");

-- Foreign keys for provisional_rental_terms
ALTER TABLE "provisional_rental_terms"
  ADD CONSTRAINT "provisional_rental_terms_dormitory_id_fkey"
  FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provisional_rental_terms"
  ADD CONSTRAINT "provisional_rental_terms_room_id_fkey"
  FOREIGN KEY ("room_id") REFERENCES "rooms"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provisional_rental_terms"
  ADD CONSTRAINT "provisional_rental_terms_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provisional_rental_terms"
  ADD CONSTRAINT "provisional_rental_terms_occupancy_id_fkey"
  FOREIGN KEY ("occupancy_id") REFERENCES "occupancies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provisional_rental_terms"
  ADD CONSTRAINT "provisional_rental_terms_converted_contract_id_fkey"
  FOREIGN KEY ("converted_contract_id") REFERENCES "contracts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. AlterTable: Add provisional_rental_term_id to bills
ALTER TABLE "bills"
  ADD COLUMN "provisional_rental_term_id" UUID;

CREATE INDEX "bills_provisional_rental_term_id_idx" ON "bills"("provisional_rental_term_id");

ALTER TABLE "bills"
  ADD CONSTRAINT "bills_provisional_rental_term_id_fkey"
  FOREIGN KEY ("provisional_rental_term_id") REFERENCES "provisional_rental_terms"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
