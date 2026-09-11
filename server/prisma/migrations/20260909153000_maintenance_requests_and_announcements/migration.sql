-- CreateTable
CREATE TABLE IF NOT EXISTS "maintenance_requests" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "request_number" VARCHAR(100) NOT NULL,
    "tenant_id" UUID,
    "contract_id" UUID,
    "room_id" UUID,
    "category" VARCHAR(100) NOT NULL DEFAULT 'other',
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "priority" VARCHAR(50) NOT NULL DEFAULT 'normal',
    "status" VARCHAR(50) NOT NULL DEFAULT 'submitted',
    "assigned_staff" VARCHAR(255),
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "note" TEXT,
    "image_before" TEXT,
    "image_after" TEXT,
    "preferred_date" DATE,
    "preferred_time_range" VARCHAR(100),
    "created_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "cancellation_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "announcements" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "type" VARCHAR(100) NOT NULL DEFAULT 'general',
    "target_type" VARCHAR(50) NOT NULL DEFAULT 'all',
    "target_building_id" UUID,
    "custom_target" VARCHAR(255),
    "target_rooms" TEXT,
    "attachment_url" TEXT,
    "link_url" TEXT,
    "author" VARCHAR(255),
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(50) NOT NULL DEFAULT 'published',
    "priority" VARCHAR(50) NOT NULL DEFAULT 'normal',
    "publish_date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,
    "archived_at" TIMESTAMPTZ,
    "created_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "announcement_audiences" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "target_type" VARCHAR(50) NOT NULL,
    "building_id" UUID,
    "floor" VARCHAR(50),
    "room_id" UUID,
    "tenant_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_maintenance_dorm_status" ON "maintenance_requests"("dormitory_id", "status");
CREATE INDEX IF NOT EXISTS "idx_maintenance_dorm_room" ON "maintenance_requests"("dormitory_id", "room_id");
CREATE INDEX IF NOT EXISTS "idx_announcement_dorm_status" ON "announcements"("dormitory_id", "status");
CREATE INDEX IF NOT EXISTS "idx_announcement_dorm_pinned" ON "announcements"("dormitory_id", "is_pinned");
CREATE INDEX IF NOT EXISTS "idx_ann_audience_dorm_ann" ON "announcement_audiences"("dormitory_id", "announcement_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_requests_dormitory_id_fkey') THEN
        ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_requests_room_id_fkey') THEN
        ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_requests_tenant_id_fkey') THEN
        ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_dormitory_id_fkey') THEN
        ALTER TABLE "announcements" ADD CONSTRAINT "announcements_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_audiences_announcement_id_fkey') THEN
        ALTER TABLE "announcement_audiences" ADD CONSTRAINT "announcement_audiences_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
