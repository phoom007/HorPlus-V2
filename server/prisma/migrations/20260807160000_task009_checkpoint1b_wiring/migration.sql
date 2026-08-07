-- Task-009 Checkpoint 1B: Runtime Wiring & Production Boundary

-- 1. Add delivery state columns to dormitory_access_grants
ALTER TABLE "dormitory_access_grants" ADD COLUMN "last_delivery_status" VARCHAR(50);
ALTER TABLE "dormitory_access_grants" ADD COLUMN "last_delivery_attempt_at" TIMESTAMPTZ;
ALTER TABLE "dormitory_access_grants" ADD COLUMN "last_delivery_success_at" TIMESTAMPTZ;
ALTER TABLE "dormitory_access_grants" ADD COLUMN "last_delivery_error_code" VARCHAR(100);

-- 2. Add verification timestamps to dormitory_line_configs
ALTER TABLE "dormitory_line_configs" ADD COLUMN "access_token_verified_at" TIMESTAMPTZ;
ALTER TABLE "dormitory_line_configs" ADD COLUMN "webhook_verified_at" TIMESTAMPTZ;

-- 3. Add message quota to subscription_plans
ALTER TABLE "subscription_plans" ADD COLUMN "message_quota_monthly" INTEGER NOT NULL DEFAULT 30;

-- Backfill quota: FREE=30, PAID=300
UPDATE "subscription_plans" SET "message_quota_monthly" = 30 WHERE "type" = 'FREE';
UPDATE "subscription_plans" SET "message_quota_monthly" = 300 WHERE "type" = 'PAID';

-- 4. Create line_push_usage table
CREATE TABLE "line_push_usage" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "period_key" VARCHAR(30) NOT NULL,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "reserved_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "line_push_usage_pkey" PRIMARY KEY ("id")
);

-- 5. Create line_push_delivery_attempts table
CREATE TABLE "line_push_delivery_attempts" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "access_grant_id" UUID NOT NULL,
    "line_retry_key" VARCHAR(36) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'RESERVED',
    "line_message_id" VARCHAR(255),
    "error_code" VARCHAR(100),
    "attempted_at" TIMESTAMPTZ,
    "finalized_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "line_push_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- 6. Indexes and constraints
CREATE UNIQUE INDEX "dormitory_push_period_unique" ON "line_push_usage"("dormitory_id", "period_key");
CREATE INDEX "line_push_delivery_attempts_access_grant_id_idx" ON "line_push_delivery_attempts"("access_grant_id");

-- Foreign keys
ALTER TABLE "line_push_usage" ADD CONSTRAINT "line_push_usage_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "line_push_delivery_attempts" ADD CONSTRAINT "line_push_delivery_attempts_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "line_push_delivery_attempts" ADD CONSTRAINT "line_push_delivery_attempts_access_grant_id_fkey" FOREIGN KEY ("access_grant_id") REFERENCES "dormitory_access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Enable RLS on new tables
ALTER TABLE "line_push_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "line_push_delivery_attempts" ENABLE ROW LEVEL SECURITY;

-- RLS policies on new tables
CREATE POLICY line_push_usage_isolation ON "line_push_usage"
  USING (
    dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

CREATE POLICY line_push_delivery_attempts_isolation ON "line_push_delivery_attempts"
  USING (
    dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- 8. FORCE ROW LEVEL SECURITY on ALL TASK-009 tables (previously only in test beforeAll)
ALTER TABLE "dormitory_line_friends" FORCE ROW LEVEL SECURITY;
ALTER TABLE "dormitory_access_grants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "dormitory_line_configs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "line_webhook_event_receipts" FORCE ROW LEVEL SECURITY;
ALTER TABLE "line_push_usage" FORCE ROW LEVEL SECURITY;
ALTER TABLE "line_push_delivery_attempts" FORCE ROW LEVEL SECURITY;

-- 9. Update policies to permit SECURITY DEFINER / bypass_rls lookup
DROP POLICY IF EXISTS dormitory_access_grants_isolation ON "dormitory_access_grants";
CREATE POLICY dormitory_access_grants_isolation ON "dormitory_access_grants"
  USING (
    dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

DROP POLICY IF EXISTS dormitory_line_friends_isolation ON "dormitory_line_friends";
CREATE POLICY dormitory_line_friends_isolation ON "dormitory_line_friends"
  USING (
    dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

DROP POLICY IF EXISTS dormitory_line_configs_isolation ON "dormitory_line_configs";
CREATE POLICY dormitory_line_configs_isolation ON "dormitory_line_configs"
  USING (
    dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid
    OR current_setting('app.bypass_rls', true) = 'true'
  );

-- Harden resolve_line_webhook_config: minimal output (routing identity only)
DROP FUNCTION IF EXISTS public.resolve_line_webhook_config(text);
CREATE OR REPLACE FUNCTION public.resolve_line_webhook_config(p_webhook_key_hash text)
RETURNS TABLE (
  config_id uuid,
  dormitory_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM set_config('app.bypass_rls', 'true', true);
  RETURN QUERY
  SELECT 
    c.id AS config_id,
    c.dormitory_id
  FROM public.dormitory_line_configs c
  WHERE c.webhook_key_hash = p_webhook_key_hash
  LIMIT 1;
END;
$$;

-- 10. Restrict function execute privileges
REVOKE ALL ON FUNCTION public.resolve_line_webhook_config(text) FROM PUBLIC;

-- Grant EXECUTE to the runtime application role (same as Prisma connection role).
-- Use DO block to grant to current_user (the Prisma migration runner = runtime role).
DO $$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.resolve_line_webhook_config(text) TO %I', current_user);
END
$$;

-- 11. Ensure runtime role has NOSUPERUSER NOBYPASSRLS for RLS enforcement
-- Only alter if the current role IS a superuser (safe: superuser can alter itself)
DO $$
DECLARE
  v_is_super boolean;
BEGIN
  SELECT rolsuper INTO v_is_super FROM pg_roles WHERE rolname = current_user;
  IF v_is_super THEN
    EXECUTE format('ALTER ROLE %I NOSUPERUSER NOBYPASSRLS', current_user);
  ELSE
    -- Already non-superuser, ensure NOBYPASSRLS
    EXECUTE format('ALTER ROLE %I NOBYPASSRLS', current_user);
  END IF;
END
$$;
