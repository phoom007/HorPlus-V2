-- Migration: 20260923210000_audit_log_append_only
-- Purpose: Enforce strict append-only immutability on audit_logs table (REQUIREMENTS-LOCK §10 & §178, N-01)

-- 1. Create trigger function to block UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE: audit_logs is append-only and cannot be modified or deleted (REQUIREMENTS-LOCK §10)';
END;
$$ LANGUAGE plpgsql;

-- 2. Attach row-level trigger preventing UPDATE and DELETE
DROP TRIGGER IF EXISTS trg_audit_logs_prevent_modification ON "audit_logs";
CREATE TRIGGER trg_audit_logs_prevent_modification
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

-- 3. Attach statement-level trigger preventing TRUNCATE
DROP TRIGGER IF EXISTS trg_audit_logs_prevent_truncate ON "audit_logs";
CREATE TRIGGER trg_audit_logs_prevent_truncate
BEFORE TRUNCATE ON "audit_logs"
FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_mutation();

-- 4. Revoke mutation privileges from runtime role horplus_app if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'horplus_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_logs" FROM horplus_app;
  END IF;
END $$;

-- 5. Drop ON DELETE CASCADE foreign key and enforce ON DELETE RESTRICT
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_dormitory_id_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON UPDATE CASCADE ON DELETE RESTRICT;
