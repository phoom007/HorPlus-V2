-- AlterTable: Add read_at and source_outbox_id to tenant_notices
ALTER TABLE "tenant_notices" ADD COLUMN "read_at" TIMESTAMPTZ,
ADD COLUMN "source_outbox_id" VARCHAR(255);

-- CreateTable: local_notification_outbox
CREATE TABLE "local_notification_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" VARCHAR(255) NOT NULL,
    "recipient_type" VARCHAR(50) NOT NULL,
    "recipient_id" VARCHAR(255),
    "recipient_role_code" VARCHAR(50),
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(255) NOT NULL,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "local_notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable: staff_notices
CREATE TABLE "staff_notices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dormitory_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_code" VARCHAR(50),
    "category" VARCHAR(100) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ,
    "source_outbox_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes & Unique Constraints
CREATE UNIQUE INDEX "local_notification_outbox_idempotency_key_key" ON "local_notification_outbox"("idempotency_key");
CREATE INDEX "local_notification_outbox_dormitory_id_status_idx" ON "local_notification_outbox"("dormitory_id", "status");
CREATE INDEX "local_notification_outbox_status_created_at_idx" ON "local_notification_outbox"("status", "created_at");

CREATE UNIQUE INDEX "staff_notice_source_outbox_user_unique" ON "staff_notices"("source_outbox_id", "user_id");
CREATE INDEX "staff_notices_dormitory_id_user_id_is_read_idx" ON "staff_notices"("dormitory_id", "user_id", "is_read");
CREATE INDEX "staff_notices_user_id_is_read_idx" ON "staff_notices"("user_id", "is_read");

CREATE INDEX "tenant_notices_dormitory_id_tenant_id_is_read_idx" ON "tenant_notices"("dormitory_id", "tenant_id", "is_read");
CREATE INDEX "tenant_notices_source_outbox_id_idx" ON "tenant_notices"("source_outbox_id");

-- Foreign Keys
ALTER TABLE "local_notification_outbox" ADD CONSTRAINT "local_notification_outbox_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_notices" ADD CONSTRAINT "staff_notices_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
