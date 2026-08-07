#!/bin/bash
# =============================================================================
# Docker entrypoint init-db wrapper
# =============================================================================
# Delegates directly to the canonical bootstrap script.
# Mounted to /docker-entrypoint-initdb.d/01_bootstrap_runtime_role.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "${SCRIPT_DIR}/bootstrap-runtime-role.sh" ]; then
  exec "${SCRIPT_DIR}/bootstrap-runtime-role.sh" "$@"
elif [ -f "/docker-entrypoint-initdb.d/bootstrap-runtime-role.sh" ]; then
  exec "/docker-entrypoint-initdb.d/bootstrap-runtime-role.sh" "$@"
else
  echo "FATAL: Canonical bootstrap-runtime-role.sh not found." >&2
  exit 1
fi
