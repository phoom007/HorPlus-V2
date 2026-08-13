-- CreateUniqueIndex for TenantNotice.sourceOutboxId
CREATE UNIQUE INDEX "tenant_notices_source_outbox_id_key" ON "tenant_notices"("source_outbox_id");

-- AlterTable: Add dismissal tracking columns to staff_notices
ALTER TABLE "staff_notices" ADD COLUMN "is_dismissed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "dismissed_at" TIMESTAMPTZ;

-- CreateIndex: Add index for staff_notices(dormitory_id, user_id, is_dismissed)
CREATE INDEX "staff_notices_dormitory_id_user_id_is_dismissed_idx" ON "staff_notices"("dormitory_id", "user_id", "is_dismissed");
