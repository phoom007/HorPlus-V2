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
#   - Uses psql -v variables with format(%I/%L) + \gexec outside PL/pgSQL blocks
#   - Never prints the password
#   - Rejects role names that are not strict alphanumeric+underscore
#   - Idempotent: safe to run multiple times
#   - Enforces NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
#   - Fails closed if existing role has elevated privileges and cannot be downgraded
# =============================================================================
set -euo pipefail

PGUSER="${PGUSER:-${POSTGRES_USER:-horplus}}"
PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-horplus_wave1d_fasttrack_test}}"
export PGUSER PGDATABASE

APP_ROLE="${HORPLUS_APP_DB_USER:-horplus_app}"
APP_PASS="${HORPLUS_APP_DB_PASSWORD:-}"

if [ -z "$APP_PASS" ]; then
  echo "FATAL: HORPLUS_APP_DB_PASSWORD is not set or empty." >&2
  echo "       Set this environment variable before running bootstrap." >&2
  exit 1
fi

if ! echo "$APP_ROLE" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$'; then
  echo "FATAL: HORPLUS_APP_DB_USER contains unsafe characters: '$APP_ROLE'" >&2
  echo "       Role name must be alphanumeric/underscore, starting with a letter or underscore." >&2
  exit 1
fi

echo "Bootstrapping runtime role '${APP_ROLE}' on database '${PGDATABASE}'..."

psql -v ON_ERROR_STOP=1 \
     -v "app_role=${APP_ROLE}" \
     -v "app_pass=${APP_PASS}" \
     --username "$PGUSER" \
     --dbname "$PGDATABASE" \
     <<'EOSQL'
SELECT format(
  'CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;',
  :'app_role',
  :'app_pass'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'app_role'
);
\gexec

SELECT format(
  'ALTER ROLE %I WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;',
  :'app_role'
)
WHERE EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'app_role' AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
) AND (SELECT rolsuper FROM pg_roles WHERE rolname = current_user);
\gexec

SELECT format(
  'ALTER ROLE %I WITH LOGIN PASSWORD %L;',
  :'app_role',
  :'app_pass'
)
WHERE EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'app_role'
);
\gexec

SELECT format(
  'DO $check$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN RAISE EXCEPTION %L; END IF; END $check$;',
  :'app_role',
  'UNSAFE_RUNTIME_ROLE_POSTURE: Role has elevated privileges (SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE). Bootstrap cannot downgrade role without superuser credentials.'
);
\gexec

SELECT format('GRANT USAGE ON SCHEMA public TO %I;', :'app_role');
\gexec

SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I;', :'app_role');
\gexec

SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I;', :'app_role');
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I;', :'app_role');
\gexec

SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I;', :'app_role');
\gexec
EOSQL

echo "Runtime role '${APP_ROLE}' bootstrap complete."
