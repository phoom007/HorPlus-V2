-- AlterTable
ALTER TABLE "billing_rate_snapshots" ADD COLUMN "common_fee_mode" VARCHAR(50) NOT NULL DEFAULT 'room',
ADD COLUMN "internet_fee_mode" VARCHAR(50) NOT NULL DEFAULT 'room',
ADD COLUMN "parking_fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
ADD COLUMN "parking_fee_mode" VARCHAR(50) NOT NULL DEFAULT 'room';

-- CreateTable
CREATE TABLE "room_billing_cycle_snapshots" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "billing_cycle_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "people_count" INTEGER NOT NULL DEFAULT 1,
    "source" VARCHAR(50) NOT NULL DEFAULT 'HOUSEHOLD_SYNC',
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "room_billing_cycle_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_billing_cycle_snapshots_dormitory_id_billing_cycle_id_idx" ON "room_billing_cycle_snapshots"("dormitory_id", "billing_cycle_id");

-- CreateIndex
CREATE INDEX "room_billing_cycle_snapshots_room_id_idx" ON "room_billing_cycle_snapshots"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_billing_cycle_snapshots_dormitory_id_billing_cycle_id__key" ON "room_billing_cycle_snapshots"("dormitory_id", "billing_cycle_id", "room_id");

-- AddForeignKey
ALTER TABLE "room_billing_cycle_snapshots" ADD CONSTRAINT "room_billing_cycle_snapshots_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_billing_cycle_snapshots" ADD CONSTRAINT "room_billing_cycle_snapshots_billing_cycle_id_fkey" FOREIGN KEY ("billing_cycle_id") REFERENCES "billing_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_billing_cycle_snapshots" ADD CONSTRAINT "room_billing_cycle_snapshots_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
