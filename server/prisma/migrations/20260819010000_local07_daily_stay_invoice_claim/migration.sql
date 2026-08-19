-- Migration: 20260819010000_local07_daily_stay_invoice_claim
-- Description: LOCAL-07 Batch 02: Daily Stay Domain, Invoicing & Claim Foundation

-- Create daily_stays table
CREATE TABLE "daily_stays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "tenant_id" UUID,
    "occupancy_id" UUID,
    "request_source" VARCHAR(50) NOT NULL DEFAULT 'OWNER',
    "applicant_full_name" VARCHAR(255),
    "applicant_phone" VARCHAR(50),
    "requester_user_id" UUID,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "inclusive_day_count" INTEGER NOT NULL,
    "daily_rate_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_rent_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "deposit_declared_status" VARCHAR(50) NOT NULL DEFAULT 'UNPAID',
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING_APPROVAL',
    "approved_at" TIMESTAMPTZ,
    "approved_by_user_id" UUID,
    "actual_checked_out_at" TIMESTAMPTZ,
    "checked_out_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "daily_stays_pkey" PRIMARY KEY ("id")
);

-- Create daily_stay_invoices table
CREATE TABLE "daily_stay_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "daily_stay_id" UUID NOT NULL,
    "invoice_number" VARCHAR(100) NOT NULL,
    "total_rent_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_agreed_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "outstanding_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "deposit_declared_status" VARCHAR(50) NOT NULL DEFAULT 'UNPAID',
    "status" VARCHAR(50) NOT NULL DEFAULT 'ISSUED',
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "daily_stay_invoices_pkey" PRIMARY KEY ("id")
);

-- Create daily_stay_invoice_items table
CREATE TABLE "daily_stay_invoice_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "item_type" VARCHAR(50) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "status" VARCHAR(50) NOT NULL DEFAULT 'OUTSTANDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_stay_invoice_items_pkey" PRIMARY KEY ("id")
);

-- Create unique index on daily_stay_invoices(daily_stay_id)
CREATE UNIQUE INDEX "daily_stay_invoices_daily_stay_id_key" ON "daily_stay_invoices"("daily_stay_id");

-- Create unique index on daily_stay_invoices(dormitory_id, invoice_number)
CREATE UNIQUE INDEX "dormitory_daily_invoice_number_unique" ON "daily_stay_invoices"("dormitory_id", "invoice_number");

-- Create indexes on daily_stays
CREATE INDEX "daily_stays_dormitory_id_idx" ON "daily_stays"("dormitory_id");
CREATE INDEX "daily_stays_room_id_idx" ON "daily_stays"("room_id");
CREATE INDEX "daily_stays_tenant_id_idx" ON "daily_stays"("tenant_id");
CREATE INDEX "daily_stays_dormitory_id_room_id_status_idx" ON "daily_stays"("dormitory_id", "room_id", "status");

-- Create indexes on daily_stay_invoices
CREATE INDEX "daily_stay_invoices_dormitory_id_idx" ON "daily_stay_invoices"("dormitory_id");
CREATE INDEX "daily_stay_invoices_daily_stay_id_idx" ON "daily_stay_invoices"("daily_stay_id");

-- Create indexes on daily_stay_invoice_items
CREATE INDEX "daily_stay_invoice_items_invoice_id_idx" ON "daily_stay_invoice_items"("invoice_id");

-- Add foreign key constraints
ALTER TABLE "daily_stays" ADD CONSTRAINT "daily_stays_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_stays" ADD CONSTRAINT "daily_stays_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_stays" ADD CONSTRAINT "daily_stays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "daily_stays" ADD CONSTRAINT "daily_stays_occupancy_id_fkey" FOREIGN KEY ("occupancy_id") REFERENCES "occupancies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_stay_invoices" ADD CONSTRAINT "daily_stay_invoices_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_stay_invoices" ADD CONSTRAINT "daily_stay_invoices_daily_stay_id_fkey" FOREIGN KEY ("daily_stay_id") REFERENCES "daily_stays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_stay_invoice_items" ADD CONSTRAINT "daily_stay_invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "daily_stay_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
