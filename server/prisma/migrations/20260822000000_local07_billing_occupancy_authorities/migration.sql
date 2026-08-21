-- AlterTable: meter_readings nullable
ALTER TABLE "meter_readings"
  ALTER COLUMN "previous_reading" DROP NOT NULL,
  ALTER COLUMN "current_reading" DROP NOT NULL,
  ALTER COLUMN "usage_units" DROP NOT NULL;

-- AlterTable: daily_stays check_in_at, check_out_at
ALTER TABLE "daily_stays"
  ADD COLUMN "check_in_at" TIMESTAMPTZ,
  ADD COLUMN "check_out_at" TIMESTAMPTZ;

-- Backfill daily_stays in Asia/Bangkok (+07:00)
UPDATE "daily_stays"
SET
  "check_in_at" = (start_date::text || ' 00:00:00+07')::timestamptz,
  "check_out_at" = ((end_date + INTERVAL '1 day')::date::text || ' 00:00:00+07')::timestamptz
WHERE "check_in_at" IS NULL;

-- CreateTable: combined_payment_groups
CREATE TABLE "combined_payment_groups" (
  "id" UUID NOT NULL,
  "dormitory_id" UUID NOT NULL,
  "tenant_id" UUID,
  "total_amount" DECIMAL(12, 2) NOT NULL,
  "method" VARCHAR(50) NOT NULL,
  "status" VARCHAR(50) NOT NULL DEFAULT 'APPROVED',
  "payment_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" UUID,
  "idempotency_key" VARCHAR(100),
  "metadata" JSONB,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "combined_payment_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "combined_payment_groups_idempotency_key_key" ON "combined_payment_groups"("idempotency_key");

ALTER TABLE "combined_payment_groups" ADD CONSTRAINT "combined_payment_groups_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "combined_payment_groups" ADD CONSTRAINT "combined_payment_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: bills add bill_kind and payment_group_id
ALTER TABLE "bills"
  ADD COLUMN "bill_kind" VARCHAR(50) NOT NULL DEFAULT 'MONTHLY_UTILITY',
  ADD COLUMN "payment_group_id" UUID;

ALTER TABLE "bills" ADD CONSTRAINT "bills_payment_group_id_fkey" FOREIGN KEY ("payment_group_id") REFERENCES "combined_payment_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "bills_dorm_cycle_room_kind_idx" ON "bills"("dormitory_id", "billing_cycle_id", "room_id", "bill_kind");

-- Backfill bills bill_kind safely based on child BillItems:
-- 1. If bill has only rent items -> RENT
-- 2. If bill has only deposit items -> DEPOSIT
-- 3. If bill has no rent or deposit items -> MONTHLY_UTILITY
-- 4. If bill has mixed rent/deposit and utility/other items -> LEGACY_COMBINED
UPDATE "bills" b
SET "bill_kind" = (
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM "bill_items" bi WHERE bi.bill_id = b.id) THEN 'MONTHLY_UTILITY'
    WHEN NOT EXISTS (SELECT 1 FROM "bill_items" bi WHERE bi.bill_id = b.id AND bi.type != 'rent') THEN 'RENT'
    WHEN NOT EXISTS (SELECT 1 FROM "bill_items" bi WHERE bi.bill_id = b.id AND bi.type != 'deposit') THEN 'DEPOSIT'
    WHEN NOT EXISTS (SELECT 1 FROM "bill_items" bi WHERE bi.bill_id = b.id AND bi.type IN ('rent', 'deposit')) THEN 'MONTHLY_UTILITY'
    ELSE 'LEGACY_COMBINED'
  END
);

-- AlterTable: payments add payment_group_id
ALTER TABLE "payments"
  ADD COLUMN "payment_group_id" UUID;

ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_group_id_fkey" FOREIGN KEY ("payment_group_id") REFERENCES "combined_payment_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: payment_upload_intents make bill_id nullable, add payment_group_id
ALTER TABLE "payment_upload_intents"
  ALTER COLUMN "bill_id" DROP NOT NULL,
  ADD COLUMN "payment_group_id" UUID;

ALTER TABLE "payment_upload_intents" ADD CONSTRAINT "payment_upload_intents_payment_group_id_fkey" FOREIGN KEY ("payment_group_id") REFERENCES "combined_payment_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 2: Database-Level Partial Unique Indexes to prevent duplicate ACTIVE bills
-- Active Monthly Utility: at most 1 active per (dormitory_id, billing_cycle_id, room_id)
CREATE UNIQUE INDEX "bills_monthly_utility_active_unique"
  ON "bills" ("dormitory_id", "billing_cycle_id", "room_id")
  WHERE "bill_kind" = 'MONTHLY_UTILITY' AND "status" NOT IN ('cancelled', 'void');

-- Active Rent for Contract: at most 1 active per (dormitory_id, billing_cycle_id, contract_id)
CREATE UNIQUE INDEX "bills_rent_contract_active_unique"
  ON "bills" ("dormitory_id", "billing_cycle_id", "contract_id")
  WHERE "bill_kind" = 'RENT' AND "contract_id" IS NOT NULL AND "status" NOT IN ('cancelled', 'void');

-- Active Rent for Provisional: at most 1 active per (dormitory_id, billing_cycle_id, provisional_rental_term_id)
CREATE UNIQUE INDEX "bills_rent_provisional_active_unique"
  ON "bills" ("dormitory_id", "billing_cycle_id", "provisional_rental_term_id")
  WHERE "bill_kind" = 'RENT' AND "provisional_rental_term_id" IS NOT NULL AND "status" NOT IN ('cancelled', 'void');

-- Active Deposit for Contract: at most 1 active per (dormitory_id, contract_id)
CREATE UNIQUE INDEX "bills_deposit_contract_active_unique"
  ON "bills" ("dormitory_id", "contract_id")
  WHERE "bill_kind" = 'DEPOSIT' AND "contract_id" IS NOT NULL AND "status" NOT IN ('cancelled', 'void');

-- Active Deposit for Provisional: at most 1 active per (dormitory_id, provisional_rental_term_id)
CREATE UNIQUE INDEX "bills_deposit_provisional_active_unique"
  ON "bills" ("dormitory_id", "provisional_rental_term_id")
  WHERE "bill_kind" = 'DEPOSIT' AND "provisional_rental_term_id" IS NOT NULL AND "status" NOT IN ('cancelled', 'void');
