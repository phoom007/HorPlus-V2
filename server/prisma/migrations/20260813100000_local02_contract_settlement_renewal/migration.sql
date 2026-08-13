-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "previous_contract_id" UUID;

-- CreateTable
CREATE TABLE "tenant_renewal_requests" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "requested_duration_months" INTEGER NOT NULL DEFAULT 1,
    "requested_start_date" DATE NOT NULL,
    "requested_end_date" DATE NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING_OWNER_APPROVAL',
    "rejection_reason" TEXT,
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by_user_id" UUID,
    "created_contract_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tenant_renewal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_settlements" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "deposit_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "unpaid_bill_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "damage_charge_total" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "net_settlement" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "settlement_direction" VARCHAR(50) NOT NULL,
    "settlement_status" VARCHAR(50) NOT NULL DEFAULT 'PENDING_REFUND',
    "confirmed_at" TIMESTAMPTZ,
    "confirmed_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "contract_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_settlement_items" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "evidence_url" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ,
    "deleted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contract_settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_notices" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenant_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_renewal_requests_room_status_idx" ON "tenant_renewal_requests"("room_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_settlements_dormitory_id_contract_id_key" ON "contract_settlements"("dormitory_id", "contract_id");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_previous_contract_id_fkey" FOREIGN KEY ("previous_contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_renewal_requests" ADD CONSTRAINT "tenant_renewal_requests_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_renewal_requests" ADD CONSTRAINT "tenant_renewal_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_renewal_requests" ADD CONSTRAINT "tenant_renewal_requests_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_renewal_requests" ADD CONSTRAINT "tenant_renewal_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_settlements" ADD CONSTRAINT "contract_settlements_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_settlements" ADD CONSTRAINT "contract_settlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_settlements" ADD CONSTRAINT "contract_settlements_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_settlements" ADD CONSTRAINT "contract_settlements_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_settlement_items" ADD CONSTRAINT "contract_settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "contract_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_notices" ADD CONSTRAINT "tenant_notices_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_notices" ADD CONSTRAINT "tenant_notices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
