-- Task-009 Checkpoint 1F: Upgrade-Safe Runtime Role Separation & RLS Grants
-- REQUIREMENT: horplus_app role MUST exist before this migration runs.
-- If missing, the migration fails with a clear error directing the operator
-- to run the runtime-role bootstrap script first.

-- Step 1: Fail fast if runtime role does not exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'horplus_app') THEN
    RAISE EXCEPTION '
HORPLUS_RUNTIME_ROLE_MISSING:
The runtime application role "horplus_app" does not exist.
Run the database runtime-role bootstrap before prisma migrate deploy:

  ./docker/bootstrap-runtime-role.sh

Or set HORPLUS_APP_DB_USER and HORPLUS_APP_DB_PASSWORD and run the bootstrap.
';
  END IF;
END $$;

-- Step 2: Grant schema, table, sequence, and resolver execute privileges to runtime role
GRANT USAGE ON SCHEMA public TO horplus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO horplus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO horplus_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO horplus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO horplus_app;

-- Step 3: Grant resolver execution privileges to horplus_app
GRANT EXECUTE ON FUNCTION public.resolve_line_webhook_config(text) TO horplus_app;
GRANT EXECUTE ON FUNCTION public.resolve_access_grant_token(text) TO horplus_app;
GRANT EXECUTE ON FUNCTION public.resolve_access_grant_by_id(uuid) TO horplus_app;
