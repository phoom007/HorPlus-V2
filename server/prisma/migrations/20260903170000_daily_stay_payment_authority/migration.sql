-- AlterTable: payments
ALTER TABLE "payments" ALTER COLUMN "bill_id" DROP NOT NULL;
ALTER TABLE "payments" ADD COLUMN "daily_stay_invoice_id" UUID;

-- AddForeignKey: payments -> daily_stay_invoices
ALTER TABLE "payments" ADD CONSTRAINT "payments_daily_stay_invoice_id_fkey" FOREIGN KEY ("daily_stay_invoice_id") REFERENCES "daily_stay_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraint: payments XOR (exactly one of bill_id or daily_stay_invoice_id must be non-null)
ALTER TABLE "payments" ADD CONSTRAINT "payments_target_xor_check" CHECK (
  ("bill_id" IS NOT NULL AND "daily_stay_invoice_id" IS NULL) OR
  ("bill_id" IS NULL AND "daily_stay_invoice_id" IS NOT NULL)
);

-- CreateIndex: payments
CREATE INDEX "idx_payments_dorm_daily_invoice" ON "payments"("dormitory_id", "daily_stay_invoice_id");

-- AlterTable: payment_allocations
ALTER TABLE "payment_allocations" ALTER COLUMN "bill_id" DROP NOT NULL;
ALTER TABLE "payment_allocations" ADD COLUMN "daily_stay_invoice_id" UUID;
ALTER TABLE "payment_allocations" ADD COLUMN "daily_stay_invoice_item_id" UUID;

-- AddForeignKey: payment_allocations -> daily_stay_invoices
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_daily_stay_invoice_id_fkey" FOREIGN KEY ("daily_stay_invoice_id") REFERENCES "daily_stay_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: payment_allocations -> daily_stay_invoice_items
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_daily_stay_invoice_item_id_fkey" FOREIGN KEY ("daily_stay_invoice_item_id") REFERENCES "daily_stay_invoice_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddCheckConstraint: payment_allocations XOR
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_target_xor_check" CHECK (
  ("bill_id" IS NOT NULL AND "daily_stay_invoice_id" IS NULL) OR
  ("bill_id" IS NULL AND "daily_stay_invoice_id" IS NOT NULL)
);

-- CreateIndex: payment_allocations
CREATE INDEX "idx_allocations_dorm_daily_invoice" ON "payment_allocations"("dormitory_id", "daily_stay_invoice_id");
CREATE INDEX "idx_allocations_dorm_daily_item" ON "payment_allocations"("dormitory_id", "daily_stay_invoice_item_id");
