#!/bin/bash
# =============================================================================
# HorPlus Runtime Role Bootstrap
# =============================================================================
# Canonical idempotent bootstrap for the runtime application database role.
#
# Invocation modes:
#   A. Fresh Docker cluster:  Mounted to /docker-entrypoint-initdb.d/
#   B. Existing cluster:      ./docker/bootstrap-runtime-role.sh
#
# Required environment:
#   PGHOST / PGPORT / PGUSER / PGDATABASE  (or POSTGRES_USER / POSTGRES_DB for Docker)
#   HORPLUS_APP_DB_USER     (optional, defaults to 'horplus_app')
#   HORPLUS_APP_DB_PASSWORD (REQUIRED — must not be empty)
#
# Safety:
#   - Uses psql -v variables with format(%I/%L) for safe identifier/literal quoting
#   - Never prints the password
#   - Rejects role names that are not strict alphanumeric+underscore
#   - Idempotent: safe to run multiple times
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve connection parameters (Docker entrypoint vs manual invocation)
# ---------------------------------------------------------------------------
PGUSER="${PGUSER:-${POSTGRES_USER:-horplus}}"
PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-horplus_wave1d_fasttrack_test}}"
export PGUSER PGDATABASE

APP_ROLE="${HORPLUS_APP_DB_USER:-horplus_app}"
APP_PASS="${HORPLUS_APP_DB_PASSWORD:-}"

# ---------------------------------------------------------------------------
# Validate inputs
# ---------------------------------------------------------------------------
# Reject empty password (except in explicitly local/test mode)
if [ -z "$APP_PASS" ]; then
  echo "FATAL: HORPLUS_APP_DB_PASSWORD is not set or empty." >&2
  echo "       Set this environment variable before running bootstrap." >&2
  exit 1
fi

# Reject unsafe role identifiers (only allow alphanumeric + underscore, 1-63 chars)
if ! echo "$APP_ROLE" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$'; then
  echo "FATAL: HORPLUS_APP_DB_USER contains unsafe characters: '$APP_ROLE'" >&2
  echo "       Role name must be alphanumeric/underscore, starting with a letter or underscore." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Bootstrap the runtime role (idempotent, safely quoted)
# ---------------------------------------------------------------------------
echo "Bootstrapping runtime role '${APP_ROLE}' on database '${PGDATABASE}'..."

psql -v ON_ERROR_STOP=1 \
     -v "app_role=${APP_ROLE}" \
     -v "app_pass=${APP_PASS}" \
     --username "$PGUSER" \
     --dbname "$PGDATABASE" \
     <<'EOSQL'
DO $$
DECLARE
  v_role text := :'app_role';
  v_pass text := :'app_pass';
BEGIN
  -- Validate role name server-side as well
  IF v_role !~ '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'Unsafe runtime role name: %', v_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', v_role, v_pass);
    RAISE NOTICE 'Created runtime role: %', v_role;
  ELSE
    -- Do not repeat NOSUPERUSER/NOBYPASSRLS on ALTER: requires superuser privilege
    -- These attributes are immutable once set by the superuser/bootstrap that created the role
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', v_role, v_pass);
    RAISE NOTICE 'Updated runtime role: %', v_role;
  END IF;

  -- Grant schema + table + sequence privileges
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', v_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', v_role);

  -- Default privileges for future tables/sequences created by migration owner
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', v_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', v_role);
END
$$;
EOSQL

echo "Runtime role '${APP_ROLE}' bootstrap complete."
