-- AlterTable
ALTER TABLE "receipts" ADD COLUMN "receipt_kind" VARCHAR(50) NOT NULL DEFAULT 'EVENT';
ALTER TABLE "receipts" ADD COLUMN "settlement_scope_key" VARCHAR(255);
ALTER TABLE "receipts" ADD COLUMN "room_id" UUID;
ALTER TABLE "receipts" ADD COLUMN "billing_cycle_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_settlement_scope_unique" ON "receipts"("dormitory_id", "settlement_scope_key");
CREATE INDEX "idx_receipts_dorm_kind" ON "receipts"("dormitory_id", "receipt_kind");
CREATE INDEX "idx_receipts_dorm_room_cycle" ON "receipts"("dormitory_id", "room_id", "billing_cycle_id");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_billing_cycle_id_fkey" FOREIGN KEY ("billing_cycle_id") REFERENCES "billing_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
