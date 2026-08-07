-- Task-009 Checkpoint 1F: Upgrade-Safe Runtime Role Separation & RLS Grants

-- Grant schema, table, sequence, and resolver execute privileges to runtime role (horplus_app) if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'horplus_app') THEN
    GRANT USAGE ON SCHEMA public TO horplus_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO horplus_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO horplus_app;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO horplus_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO horplus_app;

    -- Grant resolver execution privileges to horplus_app
    GRANT EXECUTE ON FUNCTION public.resolve_line_webhook_config(text) TO horplus_app;
    GRANT EXECUTE ON FUNCTION public.resolve_access_grant_token(text) TO horplus_app;
    GRANT EXECUTE ON FUNCTION public.resolve_access_grant_by_id(uuid) TO horplus_app;
  ELSE
    RAISE NOTICE 'Role horplus_app does not exist in target database. Ensure environment bootstrap script has been executed.';
  END IF;
END $$;
