-- Task-009 Checkpoint 1E: Database Role Separation, True RLS & Security Boundaries

-- 1. Add delivery state & token encryption columns to dormitory_access_grants
ALTER TABLE "dormitory_access_grants" ADD COLUMN IF NOT EXISTS "token_encrypted" TEXT;
ALTER TABLE "dormitory_access_grants" ADD COLUMN IF NOT EXISTS "last_delivery_status" VARCHAR(50);
ALTER TABLE "dormitory_access_grants" ADD COLUMN IF NOT EXISTS "last_delivery_attempt_at" TIMESTAMPTZ;
ALTER TABLE "dormitory_access_grants" ADD COLUMN IF NOT EXISTS "last_delivery_success_at" TIMESTAMPTZ;
ALTER TABLE "dormitory_access_grants" ADD COLUMN IF NOT EXISTS "last_delivery_error_code" VARCHAR(100);

-- 2. Add verification timestamps to dormitory_line_configs
ALTER TABLE "dormitory_line_configs" ADD COLUMN IF NOT EXISTS "access_token_verified_at" TIMESTAMPTZ;
ALTER TABLE "dormitory_line_configs" ADD COLUMN IF NOT EXISTS "webhook_verified_at" TIMESTAMPTZ;

-- 3. Add message quota to subscription_plans
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "message_quota_monthly" INTEGER NOT NULL DEFAULT 30;

-- Backfill quota: FREE=30, PAID=300
UPDATE "subscription_plans" SET "message_quota_monthly" = 30 WHERE "type" = 'FREE';
UPDATE "subscription_plans" SET "message_quota_monthly" = 300 WHERE "type" = 'PAID';

-- 4. Create line_push_usage table
CREATE TABLE IF NOT EXISTS "line_push_usage" (
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
CREATE TABLE IF NOT EXISTS "line_push_delivery_attempts" (
    "id" UUID NOT NULL,
    "dormitory_id" UUID NOT NULL,
    "access_grant_id" UUID NOT NULL,
    "period_key" VARCHAR(30) NOT NULL,
    "line_retry_key" VARCHAR(36) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'RESERVED',
    "line_message_id" VARCHAR(255),
    "error_code" VARCHAR(100),
    "attempted_at" TIMESTAMPTZ,
    "finalized_at" TIMESTAMPTZ,
    "retry_key_created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retry_key_expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "line_push_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- 6. Indexes and constraints
CREATE UNIQUE INDEX IF NOT EXISTS "dormitory_push_period_unique" ON "line_push_usage"("dormitory_id", "period_key");
CREATE INDEX IF NOT EXISTS "line_push_delivery_attempts_access_grant_id_idx" ON "line_push_delivery_attempts"("access_grant_id");

-- Foreign keys
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'line_push_usage_dormitory_id_fkey') THEN
        ALTER TABLE "line_push_usage" ADD CONSTRAINT "line_push_usage_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'line_push_delivery_attempts_dormitory_id_fkey') THEN
        ALTER TABLE "line_push_delivery_attempts" ADD CONSTRAINT "line_push_delivery_attempts_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'line_push_delivery_attempts_access_grant_id_fkey') THEN
        ALTER TABLE "line_push_delivery_attempts" ADD CONSTRAINT "line_push_delivery_attempts_access_grant_id_fkey" FOREIGN KEY ("access_grant_id") REFERENCES "dormitory_access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 7. Provision API Runtime Role (horplus_app)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'horplus_app') THEN
    CREATE ROLE horplus_app WITH LOGIN PASSWORD 'password' NOSUPERUSER NOBYPASSRLS;
  ELSE
    ALTER ROLE horplus_app WITH LOGIN PASSWORD 'password' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- Grant schema access & DML privileges to runtime role
GRANT USAGE ON SCHEMA public TO horplus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO horplus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO horplus_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO horplus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO horplus_app;

-- 8. Enable RLS on all TASK-009 tables (FORCE RLS NOT REQUIRED because runtime role is not table owner)
ALTER TABLE "dormitory_line_friends" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dormitory_access_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dormitory_line_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "line_webhook_event_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "line_push_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "line_push_delivery_attempts" ENABLE ROW LEVEL SECURITY;

-- 9. Pure tenant isolation RLS policies depending ONLY on app.current_dormitory_id (NO GUC bypass)
DROP POLICY IF EXISTS line_push_usage_isolation ON "line_push_usage";
CREATE POLICY line_push_usage_isolation ON "line_push_usage"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

DROP POLICY IF EXISTS line_push_delivery_attempts_isolation ON "line_push_delivery_attempts";
CREATE POLICY line_push_delivery_attempts_isolation ON "line_push_delivery_attempts"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

DROP POLICY IF EXISTS dormitory_access_grants_isolation ON "dormitory_access_grants";
CREATE POLICY dormitory_access_grants_isolation ON "dormitory_access_grants"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

DROP POLICY IF EXISTS dormitory_line_friends_isolation ON "dormitory_line_friends";
CREATE POLICY dormitory_line_friends_isolation ON "dormitory_line_friends"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

DROP POLICY IF EXISTS dormitory_line_configs_isolation ON "dormitory_line_configs";
CREATE POLICY dormitory_line_configs_isolation ON "dormitory_line_configs"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

DROP POLICY IF EXISTS line_webhook_event_receipts_isolation ON "line_webhook_event_receipts";
CREATE POLICY line_webhook_event_receipts_isolation ON "line_webhook_event_receipts"
  USING (dormitory_id = NULLIF(current_setting('app.current_dormitory_id', true), '')::uuid);

-- 10. Narrow SECURITY DEFINER Resolvers (Minimal Returned Identifiers, Fixed search_path)

-- Webhook config resolver
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
  RETURN QUERY
  SELECT 
    c.id AS config_id,
    c.dormitory_id
  FROM public.dormitory_line_configs c
  WHERE c.webhook_key_hash = p_webhook_key_hash
  LIMIT 1;
END;
$$;

-- Bearer token resolver
DROP FUNCTION IF EXISTS public.resolve_access_grant_token(text);
CREATE OR REPLACE FUNCTION public.resolve_access_grant_token(p_token_hash text)
RETURNS TABLE (
  grant_id uuid,
  dormitory_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    g.id AS grant_id,
    g.dormitory_id
  FROM public.dormitory_access_grants g
  WHERE g.token_hash = p_token_hash
  LIMIT 1;
END;
$$;

-- Grant resolver by grant ID for session validation
DROP FUNCTION IF EXISTS public.resolve_access_grant_by_id(uuid);
CREATE OR REPLACE FUNCTION public.resolve_access_grant_by_id(p_grant_id uuid)
RETURNS TABLE (
  grant_id uuid,
  dormitory_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    g.id AS grant_id,
    g.dormitory_id
  FROM public.dormitory_access_grants g
  WHERE g.id = p_grant_id
  LIMIT 1;
END;
$$;

-- Delete old resolve_access_grant_friend function (identity material must not be exposed)
DROP FUNCTION IF EXISTS public.resolve_access_grant_friend(uuid);

-- 11. Restrict resolver execute privileges (REVOKE FROM PUBLIC, GRANT TO API RUNTIME ROLE)
REVOKE ALL ON FUNCTION public.resolve_line_webhook_config(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_access_grant_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_access_grant_by_id(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_line_webhook_config(text) TO horplus_app;
GRANT EXECUTE ON FUNCTION public.resolve_access_grant_token(text) TO horplus_app;
GRANT EXECUTE ON FUNCTION public.resolve_access_grant_by_id(uuid) TO horplus_app;

GRANT EXECUTE ON FUNCTION public.resolve_line_webhook_config(text) TO horplus;
GRANT EXECUTE ON FUNCTION public.resolve_access_grant_token(text) TO horplus;
GRANT EXECUTE ON FUNCTION public.resolve_access_grant_by_id(uuid) TO horplus;
