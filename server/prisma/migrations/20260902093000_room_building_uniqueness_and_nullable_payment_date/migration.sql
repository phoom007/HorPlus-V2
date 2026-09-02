-- DropIndex
DROP INDEX IF EXISTS "dormitory_normalized_room_number_unique";

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "payment_date" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_building_normalized_room_number_unique" ON "rooms"("dormitory_id", "building_id", "normalized_room_number");
