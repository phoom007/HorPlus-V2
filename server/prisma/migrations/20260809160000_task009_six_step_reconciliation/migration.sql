-- Migration 17: Six-Step Onboarding Reconciliation Forward Corrections

-- 1. Create unique indexes for owner_signatures
CREATE UNIQUE INDEX "dormitory_signature_version_unique" ON "owner_signatures"("dormitory_id", "version");
CREATE UNIQUE INDEX "owner_signatures_dormitory_current_unique" ON "owner_signatures"("dormitory_id") WHERE is_current = true;

-- 2. Add LINE webhook readiness tracking columns to dormitory_line_configs
ALTER TABLE "dormitory_line_configs" ADD COLUMN "webhook_endpoint_set_at" TIMESTAMPTZ;
ALTER TABLE "dormitory_line_configs" ADD COLUMN "webhook_test_succeeded_at" TIMESTAMPTZ;
ALTER TABLE "dormitory_line_configs" ADD COLUMN "webhook_active" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dormitory_line_configs" ADD COLUMN "webhook_active_checked_at" TIMESTAMPTZ;
