-- CreateTable
CREATE TABLE "room_next_cycle_corrections" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "room_id" UUID NOT NULL,
    "people_count" INTEGER NOT NULL DEFAULT 1,
    "source" VARCHAR(50) NOT NULL DEFAULT 'METER_CORRECTION',
    "updated_by_user_id" UUID,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "room_next_cycle_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_next_cycle_corrections_dormitory_id_room_id_idx" ON "room_next_cycle_corrections"("dormitory_id", "room_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_next_cycle_corrections_dormitory_id_room_id_key" ON "room_next_cycle_corrections"("dormitory_id", "room_id");

-- AddForeignKey
ALTER TABLE "room_next_cycle_corrections" ADD CONSTRAINT "room_next_cycle_corrections_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_next_cycle_corrections" ADD CONSTRAINT "room_next_cycle_corrections_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
