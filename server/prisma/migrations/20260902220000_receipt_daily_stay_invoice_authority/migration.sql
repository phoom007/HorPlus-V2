-- AlterTable
ALTER TABLE "receipts" ADD COLUMN "daily_stay_invoice_id" UUID;

-- CreateIndex
CREATE INDEX "idx_receipts_dorm_daily_invoice" ON "receipts"("dormitory_id", "daily_stay_invoice_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_daily_stay_invoice_id_fkey" FOREIGN KEY ("daily_stay_invoice_id") REFERENCES "daily_stay_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
