#!/bin/bash
# =============================================================================
# Docker entrypoint init-db wrapper
# =============================================================================
# Delegates to the canonical bootstrap script.
# Mounted to /docker-entrypoint-initdb.d/01_init_runtime_role.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# In Docker entrypoint context, the bootstrap script is co-mounted or we
# inline the same logic. For simplicity, we inline the core bootstrap here
# since Docker entrypoint may not have the companion script at a known path.

APP_ROLE="${HORPLUS_APP_DB_USER:-horplus_app}"
APP_PASS="${HORPLUS_APP_DB_PASSWORD:-}"

# For local Docker development, allow a default password if not set
if [ -z "$APP_PASS" ]; then
  echo "WARNING: HORPLUS_APP_DB_PASSWORD not set. Using development default." >&2
  APP_PASS="horplus_local_dev_$(date +%s | sha256sum | head -c 16)"
fi

# Validate role name
if ! echo "$APP_ROLE" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$'; then
  echo "FATAL: HORPLUS_APP_DB_USER contains unsafe characters: '$APP_ROLE'" >&2
  exit 1
fi

echo "Docker entrypoint: bootstrapping runtime role '${APP_ROLE}'..."

psql -v ON_ERROR_STOP=1 \
     -v "app_role=${APP_ROLE}" \
     -v "app_pass=${APP_PASS}" \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     <<'EOSQL'
DO $$
DECLARE
  v_role text := :'app_role';
  v_pass text := :'app_pass';
BEGIN
  IF v_role !~ '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'Unsafe runtime role name: %', v_role;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', v_role, v_pass);
    RAISE NOTICE 'Created runtime role: %', v_role;
  ELSE
    EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', v_role, v_pass);
    RAISE NOTICE 'Updated runtime role: %', v_role;
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', v_role);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', v_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', v_role);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', v_role);
END
$$;
EOSQL

echo "Docker entrypoint: runtime role '${APP_ROLE}' bootstrap complete."
