-- CreateTable
CREATE TABLE "room_operational_status_changes" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "effective_billing_cycle_id" UUID NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "updated_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_operational_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dormitory_room_effective_cycle_unique" ON "room_operational_status_changes"("dormitory_id", "room_id", "effective_billing_cycle_id");

-- CreateIndex
CREATE INDEX "room_operational_status_changes_dormitory_id_room_id_idx" ON "room_operational_status_changes"("dormitory_id", "room_id");

-- CreateIndex
CREATE INDEX "room_operational_status_changes_effective_billing_cycle_id_idx" ON "room_operational_status_changes"("effective_billing_cycle_id");

-- AddForeignKey
ALTER TABLE "room_operational_status_changes" ADD CONSTRAINT "room_operational_status_changes_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_operational_status_changes" ADD CONSTRAINT "room_operational_status_changes_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_operational_status_changes" ADD CONSTRAINT "room_operational_status_changes_effective_billing_cycle_id_fkey" FOREIGN KEY ("effective_billing_cycle_id") REFERENCES "billing_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
