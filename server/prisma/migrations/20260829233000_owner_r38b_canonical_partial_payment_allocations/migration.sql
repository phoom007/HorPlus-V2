-- AlterTable receipts
ALTER TABLE "receipts" ALTER COLUMN "payment_id" DROP NOT NULL;
ALTER TABLE "receipts" ALTER COLUMN "bill_id" DROP NOT NULL;
ALTER TABLE "receipts" ADD COLUMN IF NOT EXISTS "payment_group_id" UUID;

-- AddForeignKey to receipts
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_group_id_fkey" FOREIGN KEY ("payment_group_id") REFERENCES "combined_payment_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_receipts_dorm_group" ON "receipts"("dormitory_id", "payment_group_id");

-- CreateTable payment_allocations
CREATE TABLE IF NOT EXISTS "payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "payment_group_id" UUID,
    "payment_id" UUID,
    "bill_id" UUID NOT NULL,
    "bill_item_id" UUID,
    "allocated_amount" DECIMAL(12,2) NOT NULL,
    "allocation_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- AddForeignKeys to payment_allocations
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_group_id_fkey" FOREIGN KEY ("payment_group_id") REFERENCES "combined_payment_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bill_item_id_fkey" FOREIGN KEY ("bill_item_id") REFERENCES "bill_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndexes on payment_allocations
CREATE INDEX IF NOT EXISTS "idx_allocation_dorm_bill" ON "payment_allocations"("dormitory_id", "bill_id");
CREATE INDEX IF NOT EXISTS "idx_allocation_dorm_group" ON "payment_allocations"("dormitory_id", "payment_group_id");
CREATE INDEX IF NOT EXISTS "idx_allocation_dorm_payment" ON "payment_allocations"("dormitory_id", "payment_id");

-- Drop legacy unique index that prevented multiple APPROVED partial payments on the same bill
DROP INDEX IF EXISTS "payments_active_or_approved_unique";

-- Recreate active review unique index for only in-progress submissions
CREATE UNIQUE INDEX IF NOT EXISTS "payments_active_review_unique" ON "payments"("bill_id") WHERE status IN ('PENDING', 'UNDER_REVIEW');
